import {ok} from 'node:assert'
import {readFileSync} from 'node:fs'
import _pg from 'pg'
const {Pool} = _pg

// pg doesn't support $PGSSLROOTCERT yet, so we pass it in ourselves if SSL is not disabled.
// see https://github.com/brianc/node-postgres/issues/2723

// https://github.com/brianc/node-postgres/blob/pg%408.12.0/packages/pg/lib/defaults.js#L43
let ssl = false
// > PGSSLMODE behaves the same as the sslmode connection parameter.
// https://www.postgresql.org/docs/14/libpq-envars.html
// > sslmode – This option determines whether or with what priority a secure SSL TCP/IP connection will be negotiated with the server. There are six modes:
// > - disable – only try a non-SSL connection
// > […]
// https://www.postgresql.org/docs/14/libpq-connect.html#LIBPQ-CONNECT-SSLMODE
if (process.env.PGSSLMODE && process.env.PGSSLMODE !== 'disable') {
	ssl = {}
	if ('PGSSLROOTCERT' in process.env) {
		ok(process.env.PGSSLROOTCERT, '$PGSSLROOTCERT must not be empty')
		ssl.ca = readFileSync(process.env.PGSSLROOTCERT, {encoding: 'utf8'})
	}
}

const getPgOpts = (opt = {}) => {
	const pgOpts = {
		...opt,
		// todo: let this depend on the configured matching parallelism
		max: parseInt(process.env.PG_POOL_SIZE || '30'),
	}
	if (ssl || opt.ssl) {
		pgOpts.ssl = {
			...(ssl || {}),
			...(opt.ssl || {}),
		}
	}
	return pgOpts
}

const connectToPostgres = async (opt = {}) => {
	// todo?
	// > Do not use pool.query if you need transactional integrity: the pool will dispatch every query passed to pool.query on the first available idle client. Transactions within PostgreSQL are scoped to a single client and so dispatching individual queries within a single transaction across multiple, random clients will cause big problems in your app and not work. For more info please read transactions.
	// https://node-postgres.com/api/pool
	const db = new Pool(getPgOpts(opt))

	// todo: don't parse timestamptz into JS Date, keep ISO 8601 strings
	// todo: don't parse date into JS Date, keep ISO 8601 strings
	// https://github.com/brianc/node-pg-types

	const client = await db.connect()
	client.release()

	return db
}

export {
	getPgOpts,
	connectToPostgres,
}
