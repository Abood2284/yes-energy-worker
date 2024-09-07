# CSV Processing Worker for Forecast Data

## Table of Contents

1. [Introduction](#introduction)
2. [Features](#features)
3. [Prerequisites](#prerequisites)
4. [Setup](#setup)
5. [Usage](#usage)
6. [API Endpoints](#api-endpoints)
7. [Data Structure](#data-structure)
8. [Modifying the Code](#modifying-the-code)
9. [Important Considerations](#important-considerations)
10. [Troubleshooting](#troubleshooting)

## Introduction

This project is a Cloudflare Worker designed to process large CSV files containing forecast data. It reads CSV files from Cloudflare R2 storage, processes the data, and stores it in a Cloudflare D1 database. The worker is built using the Hono framework and TypeScript.

## Features

- Process large CSV files containing forecast data
- Store processed data in a Cloudflare D1 database
- Handle multiple types of forecast data (load forecasts and actual load)
- Provide API endpoints for data retrieval and processing
- Implement CORS for cross-origin requests

## Prerequisites

- Node.js and npm installed on your local machine
- A Cloudflare account with Workers, R2, and D1 enabled
- Basic knowledge of TypeScript and Cloudflare Workers

## Setup

1. Clone the repository:

   ```
   git clone https://your-repository-url.git
   cd your-project-directory
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Configure your `wrangler.toml` file with your Cloudflare account details, R2 bucket, and D1 database:

   ```toml
   name = "your-worker-name"
   main = "src/index.ts"
   compatibility_date = "2023-01-01"

   [[d1_databases]]
   binding = "DB"
   database_name = "your-d1-database-name"
   database_id = "your-d1-database-id"

   [[r2_buckets]]
   binding = "BUCKET"
   bucket_name = "your-r2-bucket-name"
   ```

4. Deploy the worker:
   ```
   npx wrangler deploy
   ```

## Usage

1. Upload your CSV files to your configured R2 bucket.

2. Use the provided API endpoints to process the CSV files and retrieve data.

3. Monitor the Cloudflare Workers logs for processing details and any errors.

## API Endpoints

1. **Process Entire CSV File**

   - URL: `/api/process-entire-csv`
   - Method: POST
   - Body: `{ "fileName": "your-file-name.csv" }`
   - Description: Processes the entire CSV file and stores the data in the D1 database.

2. **Get Forecast Data**

   - URL: `/api/forecast/:type`
   - Method: GET
   - Query Parameters: `startDate`, `endDate`
   - Description: Retrieves forecast data for a specific type within a date range.

3. **Clear Database**
   - URL: `/api/clear-database`
   - Method: DELETE
   - Description: Clears all data from the database tables.

## Data Structure

The worker expects CSV files with the following structure:

For load forecasts:

- Headers: date, time, load_fcst, revision

For actual load:

- Headers: date, time, load_act

Ensure your CSV files match this structure for proper processing.

## Modifying the Code

The main logic is contained in the `ForecastDataAccess` class in `src/index.ts`. Key methods include:

- `processEntireCSVFile`: Processes an entire CSV file.
- `storeForecastData`: Stores processed data in the D1 database.
- `getForecastData`: Retrieves forecast data from the database.

To modify the code:

1. Make changes to the relevant methods in `src/index.ts`.
2. Test your changes locally using `wrangler dev`.
3. Deploy the updated worker using `npx wrangler deploy`.

## Important Considerations

1. **File Size Limitations**: Processing very large files in a single request may exceed Cloudflare Workers' CPU and memory limits. Consider implementing a chunked processing approach for large files.

2. **Execution Time**: Workers have a maximum execution time (30 seconds for free plans, up to 15 minutes for paid plans). Ensure your processing completes within these limits.

3. **Data Validation**: The current implementation includes basic data validation. Enhance this as needed for your specific use case.

4. **Error Handling**: Implement robust error handling and logging to troubleshoot issues in production.

5. **Security**: Implement proper authentication and authorization for your API endpoints in a production environment.

## Troubleshooting

- If you encounter "Too many API requests" errors, consider implementing a chunked processing approach or increasing your Cloudflare plan limits.
- For memory-related issues, try processing smaller chunks of data at a time.
- Check the Cloudflare Workers logs for detailed error messages and processing information.

For further assistance, consult the Cloudflare Workers documentation or seek help from the Cloudflare community forums.
