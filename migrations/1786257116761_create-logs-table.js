/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createTable('logs', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },

    timestamp: {
      type: 'timestamptz',
      notNull: true,
    },

    level: {
      type: 'varchar(20)',
      notNull: true,
    },

    service: {
      type: 'varchar(100)',
      notNull: true,
    },

    message: {
      type: 'text',
      notNull: true,
    },

    metadata: {
      type: 'jsonb',
      notNull: false,
    },

    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('logs', ['timestamp', 'id'], {
    name: 'idx_logs_timestamp_id',
  });

  pgm.createIndex('logs', ['service', 'timestamp', 'id'], {
    name: 'idx_logs_service_timestamp_id',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropTable('logs');
};
