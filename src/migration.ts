import {Client} from 'pg';
import {sql} from 'sqlmint';
import {join} from 'path';
import {readdir, readFile} from 'fs/promises';

export class FilesMigrationsSource {
    private fileNames: Array<[upgrade: string, downgrade?: string]> = [];
    private ready: Promise<void>;
    constructor (private path: string) {}
    private async init() {
        return this.ready ??= (async () => {
            const files = await readdir(this.path);
            await Promise.all(
                files
                    .map(name => name.match(/^(\d+)(?:-[^.]*)?.sql$/))
                    .filter((match): match is RegExpMatchArray => !!match)
                    .map(async match => {
                        const index = parseInt(match[1])-1;
                        if (this.fileNames[index]) {
                            throw new Error(`Ambiguous file names for migration [${index+1}]`);
                        }
                        this.fileNames[index] = [match[0]];
                    }),
            );
            [...this.fileNames].forEach((migration, index) => {
                if (!migration) {
                    throw new Error(`Migration [${index+1}] missed`);
                }
            });
            await Promise.all(
                files
                    .map(name => name.match(/^(\d+)(?:-[^.]*)?.revert.sql$/))
                    .filter((match): match is RegExpMatchArray => !!match)
                    .map(async match => {
                        const index = parseInt(match[1])-1;
                        const item = this.fileNames[index];
                        if (!item) {
                            throw new Error(`There is a revert file for migration [${index+1}] which doesn't exist`);
                        }
                        if (item.length > 1) {
                            throw new Error(`Ambiguous file names for migration revert [${index+1}]`);
                        }
                        this.fileNames[index][1] = match[0];
                    }),
            );
        })();
    }
    public async getLastVersion() {
        await this.init();
        return this.fileNames.length;
    };
    public async readMigrationSql(migration: number, upgrade: boolean): Promise<string> {
        await this.init();
        const fileName = this.fileNames[migration-1][upgrade ? 0 : 1];
        if (!fileName) {
            throw new Error(`File for ${upgrade ? 'migration' : 'revert'} [${migration}] doesn't exist`);
        }
        const content = await readFile(
            join(this.path, fileName),
            'utf8',
        );
        return content.trim();
    };

}

interface MigrationPart {
    comment: string;
    sql?: string;
}

export class Migrator {
    constructor (private client: Client, private scope: string) {}

    public async getCurrentDbVersion() {
        await this.client.query(sql`
            CREATE TABLE IF NOT EXISTS _migration_versions(scope VARCHAR(100) NOT NULL PRIMARY KEY, version INTEGER NOT NULL);
            INSERT INTO _migration_versions(scope, version) VALUES(${this.scope}, 0) ON CONFLICT DO NOTHING;
        `.rawSql);
        const {rows: [{version}]} = await this.client.query<{
            version: number;
        }>(sql`SELECT version FROM _migration_versions WHERE scope=${this.scope}`.rawSql);
        return version;
    };

    private buildMigrationTransaction(fromVersion: number, toVersion: number, query: string): string {
        return sql`DO $PGUPMIGRATION$\nBEGIN\nUPDATE _migration_versions SET version=${toVersion} WHERE scope=${this.scope} AND version=${fromVersion};\nIF NOT found THEN\n  RAISE EXCEPTION ${`Expected version of db is ${fromVersion}`};\nEND IF;\n${sql.raw(query)}\nEND$PGUPMIGRATION$;\n`.rawSql;
    };

    public async getMigrationParts({source, revert, from, to}: {
        source: FilesMigrationsSource;
        revert?: boolean;
        from?: number;
        to?: number;
    }): Promise<MigrationPart[]> {
        const parts: MigrationPart[] = [];

        parts.push({
            comment: revert ? 'Reverting' : 'Upgrading',
        });

        if (from === undefined) {
            from = await this.getCurrentDbVersion();
            parts.push({comment: `from: ${from} (automatically detected)`});
        } else {
            parts.push({comment: `from: ${from} (manually provided)`});
        }

        if (to === undefined) {
            if (revert) {
                throw new Error('You should provide "to" param when reverting');
            }
            to = await source.getLastVersion();
            parts.push({comment: `to: ${to} (automatically detected)`});
        } else {
            parts.push({comment: `to: ${to} (manually provided)`});
        }

        if (revert) {
            if (from <= to) {
                throw new Error(`Can\'t revert from ${from} to ${to}`);
            }
            for (let index = from; index > to; index--) {
                parts.push({
                    comment: `Transaction ${index} -> ${index - 1}`,
                    sql: this.buildMigrationTransaction(
                        index,
                        index - 1,
                        await source.readMigrationSql(index, false)
                    ),
                });
            }
        } else {
            if (from === to) {
                parts.push({
                    comment: 'Ignore',
                });
                return parts;
            }
            if (from > to) {
                throw new Error(`Can\'t migrate from ${from} to ${to}`);
            }
            for (let index = from + 1; index <= to; index++) {
                parts.push({
                    comment: `Transaction ${index - 1} -> ${index}`,
                    sql: this.buildMigrationTransaction(
                        index - 1,
                        index,
                        await source.readMigrationSql(index, true),
                    ),
                });
            }
        }
        return parts;
    }

    public static migrationPartsToSql(parts: MigrationPart[]): string {
        return parts.map(part => {
            const subParts: string[] = [];
            if (part.comment) {
                subParts.push(`-- ${part.comment}`);
            }
            if (part.sql) {
                subParts.push(part.sql);
            }
            return subParts.join('\n');
        }).join('\n');
    }

    public async runMigrationParts(
        parts: MigrationPart[],
        log: (t: string) => void,
    ): Promise<void> {
        for (const part of parts) {
            log(part.comment);
            if (part.sql) {
                await this.client.query(part.sql);
            }
        }
    }
}
