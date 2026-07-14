#!/usr/bin/env node
import {Client} from 'pg';
import {defaultValue, object, optional, string, strToBoolean, strToInt} from 'checkeasy';

import {FilesMigrationsSource, Migrator} from '../migration';

const [,, cmd, ...params] = process.argv;
const {
    PGUP_SCOPE,
    PGUP_MIGRATIONS_PATH,
    PGUP_LOCK,
    PGUP_CONNECTION_STRING,
} = object({
    PGUP_SCOPE: defaultValue('default', string()),
    PGUP_MIGRATIONS_PATH: defaultValue('migrations', string()),
    PGUP_LOCK: defaultValue(1012, strToInt()),
    PGUP_CONNECTION_STRING: optional(string()),
}, {
    ignoreUnknown: true,
})(process.env, 'env');

export const bin = (handler: () => Promise<void>) => {
    (async () => {
        try {
            await handler();
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    })();
};

const parseParams = (args: string[]): Record<string, any> => {
    const res: any = {};
    for (const arg of args) {
        let matched = arg.match(/^--([a-zA-Z0-9][-a-zA-Z0-9]+)(?:=(.*))?$/);
        if (!matched) {
            throw new Error('Wrong params syntax');
        }
        res[matched[1]] = matched[2] ?? true;
    }
    return res;
};

bin(async () => {
    const source = new FilesMigrationsSource(PGUP_MIGRATIONS_PATH);

    const init = async () => {
        const client = new Client({
            connectionString: PGUP_CONNECTION_STRING,
        });
        await client.connect();
        const migrator = new Migrator(client, PGUP_SCOPE);
        return {
            client,
            migrator,
        }
    };

    switch (cmd) {
        case 'run': {
            const {client, migrator} = await init();
            try {
                const {dry, from, to, revert} = object({
                    dry: optional(strToBoolean()),
                    from: optional(strToInt({min: 0})),
                    revert: optional(strToBoolean()),
                    to: optional(strToInt({min: 0})),
                })(parseParams(params), 'cliParams');

                if (!dry && PGUP_LOCK) {
                    process.stdout.write(`Set migration lock (${PGUP_LOCK})\n`);
                    await client.query(`SELECT pg_advisory_lock(${PGUP_LOCK});`);
                }

                const parts = await migrator.getMigrationParts({
                    source,
                    to,
                    from,
                    revert,
                });

                if (dry) {
                    process.stdout.write(Migrator.migrationPartsToSql(parts));
                } else {
                    await migrator.runMigrationParts(parts, t => {
                        process.stdout.write(`${t}\n`);
                    });
                }
            } finally {
                await client.end();
            }

            break;
        }
        case 'db-version': {
            const {client, migrator} = await init();
            try {
                const version = await migrator.getCurrentDbVersion();
                process.stdout.write(version.toString());
            } finally {
                await client.end();
            }
            break;
        }
        default:
            process.stdout.write(`
pgup - Small schema migration tool for postgres

Commands:

    > pgup run [--dry] [--from=...] [--revert] [--to=...]
    
        Runs a migration
    
        Params:
        
            --dry - Instructs to not run a migration on a database. Only prints sql to the output.
            --from - Current version of a db. If not passed, version will be taken from db.
                DON'T PASS IT unless you know what are you doing
            --to - Version db should be migrated to. If not passed, migration will be done to the latest migration file
            --revert - Revert db migration (if possible)
            
        Env variables:
        
            PGUP_CONNECTION_STRING
                Database connection string (e. g. postgresql://user:psw@server:5432/db?sslmode=require)
        
            PGHOST
            PGPORT
            PGDATABASE
            PGUSER
            PGPASSWORD
                ... or any other params supported by libpq ( visit https://www.postgresql.org/docs/9.1/libpq-envars.html )
        
            PGUP_MIGRATIONS_PATH
                A path where your migration '<version>.sql' files stored.
                Default: 'migrations'.
        
            PGUP_SCOPE
                Name of pgup scope (in the case, you store few projects in the same database)
                Default: 'default'
            
            PGUP_LOCK
                pgup uses advisory db lock to prevent attempts of simultaneous migrations by few pgup app instances during deployment
                Default: 1012
                Set 0, to disable advisory lock
        
    > pgup db-version
    
        Shows a current version of a database
        
        The same env vars can be passed, as for "run" command
    
    > pgup [help]
    
        Shows help info

`
            );
            return;
    }
});
