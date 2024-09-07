// src/index.ts

import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
  BUCKET: R2Bucket
}

interface ForecastRecord {
  date: string;
  time: string;
  load_fcst?: string;
  load_act?: string;
  revision?: string;
  [key: string]: string | undefined;
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin: ['http://localhost:3000', 'https://your-domain.com'],
  allowMethods: ['POST', 'GET', 'OPTIONS', 'DELETE'],
  allowHeaders: ['Content-Type'],
  exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
  maxAge: 600,
  credentials: true,
}))

function parseCSV(csv: string, type: string): ForecastRecord[] {
  try {
    const lines = csv.split('\n');
    if (lines.length < 2) {
      throw new Error('CSV file is empty or has no data rows');
    }

    const headers = lines[0].split(',').map(header => header.trim());
    console.log('CSV Headers:', headers);

    let expectedHeaders: string[];
    if (type === 'load') {
      expectedHeaders = ['date', 'time', 'load_act'];
    } else {
      expectedHeaders = ['date', 'time', 'load_fcst', 'revision'];
    }

    const missingHeaders = expectedHeaders.filter(header => !headers.includes(header));
    if (missingHeaders.length > 0) {
      throw new Error(`Missing expected headers: ${missingHeaders.join(', ')}`);
    }

    return lines.slice(1).map((line, index) => {
      const values = line.split(',');
      if (values.length !== headers.length) {
        console.warn(`Line ${index + 2} has ${values.length} values, expected ${headers.length}`);
      }
      const record: ForecastRecord = {
        date: '',
        time: '',
        load_fcst: undefined,
        load_act: undefined,
        revision: undefined
      };
      headers.forEach((header, i) => {
        if (header in record) {
          record[header as keyof ForecastRecord] = values[i] ? values[i].trim() : undefined;
        }
      });
      return record;
    });
  } catch (error) {
    console.error('Error parsing CSV:', error);
    throw new Error(`Failed to parse CSV: ${error}`);
  }
}

class ForecastDataAccess {
  private db: D1Database
  private bucket: R2Bucket

  constructor(db: D1Database, bucket: R2Bucket) {
    this.db = db
    this.bucket = bucket
  }

  async getForecastData(type: string, startDate: string, endDate: string): Promise<ForecastRecord[]> {
    const file = await this.bucket.get(`${type}_load_fcst_archive.csv`);
    if (!file) throw new Error('File not found');

    const content = await file.text();
    const records = parseCSV(content, type);

    // Filter records by date range
    const filteredRecords = records.filter(record =>
      record.date >= startDate && record.date <= endDate
    );

    // Group records by date and time
    const groupedRecords = filteredRecords.reduce((acc, record) => {
      const key = `${record.date}_${record.time}`;
      if (!acc[key] || (record.revision && acc[key].revision && new Date(record.revision) > new Date(acc[key].revision))) {
        acc[key] = record;
      }
      return acc;
    }, {} as Record<string, ForecastRecord>);

    // Convert back to array and sort
    return Object.values(groupedRecords).sort((a, b) =>
      a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
    );
  }

  async storeForecastData(type: string, data: ForecastRecord[]) {
    const tableName = type === 'load' ? 'load_act' : `${type}_load_fcst`;
    const fieldName = type === 'load' ? 'load_act' : 'load_fcst';

    console.log(`Starting to store ${data.length} records for type: ${type}`);

    // Group records by date and time, keeping only the latest revision
    const latestRecords = data.reduce((acc, record) => {
      const key = `${record.date}_${record.time}`;
      if (!acc[key] || (record.revision && (!acc[key].revision || new Date(record.revision) > new Date(acc[key].revision)))) {
        acc[key] = record;
      }
      return acc;
    }, {} as Record<string, ForecastRecord>);

    const records = Object.values(latestRecords);
    console.log(`Grouped records, now have ${records.length} unique date/time combinations`);

    let insertedCount = 0;
    let errorCount = 0;

    for (const record of records) {
      const value = record[fieldName];
      if (value !== undefined) {
        try {
          if (type === 'load') {
            await this.db.prepare(
              `INSERT OR REPLACE INTO ${tableName} (date, time, ${fieldName}) VALUES (?, ?, ?)`
            ).bind(record.date, record.time, value).run();
          } else {
            await this.db.prepare(
              `INSERT OR REPLACE INTO ${tableName} (date, time, ${fieldName}, revision) VALUES (?, ?, ?, ?)`
            ).bind(record.date, record.time, value, record.revision).run();
          }
          insertedCount++;

          if (insertedCount % 1000 === 0) {
            console.log(`Inserted ${insertedCount} records so far`);
          }
        } catch (error) {
          console.error(`Error inserting record:`, error);
          console.error(`Problematic record:`, JSON.stringify(record));
          errorCount++;
        }
      } else {
        console.warn(`Missing ${fieldName} for record: ${JSON.stringify(record)}`);
      }
    }

    console.log(`Finished storing records. Inserted: ${insertedCount}, Errors: ${errorCount}`);
    return insertedCount;
  }

  async clearDatabase() {
    const tables = ['d_load_fcst', 'j_load_fcst', 'mm_load_fcst', 'mw_load_fcst', 'load_act'];
    for (const table of tables) {
      await this.db.prepare(`DELETE FROM ${table}`).run();
    }
  }

  async processCSVChunk(fileName: string, startLine: number, chunkSize: number) {
    const file = await this.bucket.get(fileName);
    if (!file) throw new Error('File not found');

    const content = await file.text();
    const lines = content.split('\n');
    const headers = lines[0].split(',').map(header => header.trim());
    
    const type = fileName.startsWith('load_act') ? 'load' : fileName.split('_')[0].toLowerCase();
    
    console.log(`Processing ${fileName} from line ${startLine} to ${startLine + chunkSize}`);
    console.log(`Headers: ${headers.join(', ')}`);

    let validRecords = 0;
    let invalidRecords = 0;
    let duplicateRecords = 0;

    const records = lines.slice(startLine, startLine + chunkSize).map(line => {
      const values = line.split(',');
      const record: ForecastRecord = {
        date: '',
        time: '',
        load_fcst: undefined,
        load_act: undefined,
        revision: undefined
      };
      headers.forEach((header, i) => {
        if (header in record) {
          record[header as keyof ForecastRecord] = values[i] ? values[i].trim() : undefined;
        }
      });

      // Validate record
      if (record.date && record.time && (record.load_fcst || record.load_act)) {
        validRecords++;
        return record;
      } else {
        invalidRecords++;
        console.warn(`Invalid record at line ${startLine + validRecords + invalidRecords}: ${line}`);
        return null;
      }
    }).filter((record): record is ForecastRecord => record !== null);

    console.log(`Valid records: ${validRecords}, Invalid records: ${invalidRecords}`);

    // Group records by date and time, keeping only the latest revision
    const latestRecords = records.reduce((acc, record) => {
      const key = `${record.date}_${record.time}`;
      if (!acc[key] || (record.revision && (!acc[key].revision || new Date(record.revision) > new Date(acc[key].revision)))) {
        acc[key] = record;
      } else {
        duplicateRecords++;
      }
      return acc;
    }, {} as Record<string, ForecastRecord>);

    console.log(`Unique records after grouping: ${Object.keys(latestRecords).length}`);
    console.log(`Duplicate records (older revisions): ${duplicateRecords}`);

    const insertedCount = await this.storeForecastData(type, Object.values(latestRecords));

    return {
      processedLines: chunkSize,
      validRecords,
      invalidRecords,
      duplicateRecords,
      insertedCount,
      hasMore: startLine + chunkSize < lines.length
    };
  }
}

// Routes
app.get('/api/forecast/:type', async (c) => {
  const type = c.req.param('type');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  if (!type || !startDate || !endDate) {
    return c.json({ error: 'Missing parameters' }, 400);
  }

  const dataAccess = new ForecastDataAccess(c.env.DB, c.env.BUCKET);

  try {
    const data = await dataAccess.getForecastData(type, startDate, endDate);
    return c.json({ data });
  } catch (error) {
    console.error('Error fetching forecast data:', error);
    return c.json({ error: 'Error fetching forecast data' }, 500);
  }
});

app.post('/webhook/forecast-update', async (c) => {
  const { type, data } = await c.req.json();

  if (!type || !data || !Array.isArray(data)) {
    return c.json({ error: 'Invalid payload' }, 400);
  }

  const dataAccess = new ForecastDataAccess(c.env.DB, c.env.BUCKET);

  try {
    await dataAccess.storeForecastData(type, data);
    return c.json({ message: 'Forecast data updated successfully' });
  } catch (error) {
    console.error('Error updating forecast data:', error);
    return c.json({ error: 'Error updating forecast data' }, 500);
  }
});

app.delete('/api/clear-database', async (c) => {
  const dataAccess = new ForecastDataAccess(c.env.DB, c.env.BUCKET);
  
  try {
    await dataAccess.clearDatabase();
    return c.json({ message: 'Database cleared successfully' });
  } catch (error) {
    console.error('Error clearing database:', error);
    return c.json({ error: 'Error clearing database' }, 500);
  }
});

// New route to initiate processing of a specific CSV file
app.post('/api/process-csv', async (c) => {
  const { fileName } = await c.req.json();
  const dataAccess = new ForecastDataAccess(c.env.DB, c.env.BUCKET);
  
  try {
    const result = await dataAccess.processCSVChunk(fileName, 1, 1000); // Start from line 1 (after headers) and process 1000 lines
    return c.json({
      message: 'CSV chunk processed',
      fileName,
      processedLines: result.processedLines,
      validRecords: result.validRecords,
      invalidRecords: result.invalidRecords,
      duplicateRecords: result.duplicateRecords,
      insertedCount: result.insertedCount,
      hasMore: result.hasMore
    });
  } catch (error) {
    console.error('Error processing CSV chunk:', error);
    return c.json({ error: 'Error processing CSV chunk', details: error instanceof Error ? error.message : String(error) }, 500);
  }
});

// New route to continue processing a CSV file from a specific line
app.post('/api/continue-csv-processing', async (c) => {
  const { fileName, startLine } = await c.req.json();
  const dataAccess = new ForecastDataAccess(c.env.DB, c.env.BUCKET);
  
  try {
    const result = await dataAccess.processCSVChunk(fileName, startLine, 1000);
    return c.json({
      message: 'CSV chunk processed',
      fileName,
      processedLines: result.processedLines,
      insertedCount: result.insertedCount,
      hasMore: result.hasMore
    });
  } catch (error) {
    console.error('Error processing CSV chunk:', error);
    return c.json({ error: 'Error processing CSV chunk', details: error instanceof Error ? error.message : String(error) }, 500);
  }
});

export default app;