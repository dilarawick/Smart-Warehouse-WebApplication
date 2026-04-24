import sql from 'mssql';

// Module-level pool singleton — reused across hot-reloads in Next.js dev
let _pool: sql.ConnectionPool | null = null;
let _poolPromise: Promise<sql.ConnectionPool> | null = null;

function getConfig(): sql.config {
  return {
    server: process.env.AZURE_SQL_SERVER as string,
    database: process.env.AZURE_SQL_DATABASE as string,
    user: process.env.AZURE_SQL_USER as string,
    password: process.env.AZURE_SQL_PASSWORD as string,
    port: parseInt(process.env.AZURE_SQL_PORT || '1433'),
    options: {
      encrypt: true,           // Required for Azure SQL
      trustServerCertificate: false,
      enableArithAbort: true,
      connectTimeout: 30000,
      requestTimeout: 30000,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

export async function getPool(): Promise<sql.ConnectionPool> {
  if (_pool && _pool.connected) return _pool;

  if (_poolPromise) return _poolPromise;

  _poolPromise = sql.connect(getConfig()).then((pool) => {
    _pool = pool;
    console.log('[DB] Connected to Azure SQL');

    pool.on('error', (err) => {
      console.error('[DB] Pool error:', err);
      _pool = null;
      _poolPromise = null;
    });

    return pool;
  }).catch((err) => {
    _poolPromise = null;
    console.error('[DB] Connection failed:', err.message);
    throw err;
  });

  return _poolPromise;
}
