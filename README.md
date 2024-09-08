# pgup

Small schema migration tool for postgres

# Short instruction

- Install library into your project:

  ```bash
  npm i pgup
  ```

- Place your migrations scripts in `migrations` folder:

  ```
  # ./migrations

  1-initial.sql
  2-add-some-changes.sql
  ...
  ```
  
- If you want to make possible to revert version of database version from higher to lower one, you can optionally add `.revert.sql` scripts:

```
  # ./migrations

  1-initial.sql
  1-initial.revert.sql
  2-add-some-changes.sql
  2-add-some-changes.revert.sql
```

- Now you can run `pgup run` to run your migrations

  Make sure you provide env variables to connect to the database: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`...

  To see all possible connection env configs, visit https://www.postgresql.org/docs/9.1/libpq-envars.html
  
- Optionally, you can add migration script to your `package.json`

  ```
  # ./package.json
  # ...
  
  "scripts": {
  
      "migration": "pgup run"
      
  }
  ```

# Commands

## run

```bash
pgup run [--dry] [--from=...] [--revert] [--to=...]
```
    
Runs a migration. From current (or passed) version of database to last (or passed) version.

Each migration will be done in separate database transaction.

If final version should be lower than current one, you should add `--revert` param. By default, it fails to migrate to lower version.

Params:

- `--dry` - Instructs to not run a migration on a database. Only prints sql to the output.
- `--from` - Current version of a db. If not passed, version will be taken from db.

  DON'T PASS IT unless you know what are you doing
- `--to` - Version db should be migrated to. If not passed, migration will be done to the latest migration file
- `--revert` - Revert db migration (if possible)
    
Env variables:

- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` - Credentials to your database
  
  To see all possible connection configs, visit https://www.postgresql.org/docs/9.1/libpq-envars.html

- `PGUP_SCOPE` - If you store more then one project in the same database, use this env to pass a unique project name.
  Actual database version will be stored in table _migration_versions(scope, version)
  Default scope is `default`

- `PGUP_MIGRATIONS_PATH` - If folder with your `<version>.sql` files is other than `migrations`, put its name in this env.
 
- `PGUP_LOCK` - pgup uses advisory db lock to be set to prevent attempts of simultaneous migrations by few pgup app instances during deployment.
  Default advisory lock is 1012, but you can change its value with this env
  You can set it to 0, if you want to disable locking feature
        
## db-version

```bash
pgup db-version
```
    
Shows a current version of a database
        
The same env vars can be passed, as for "run" command

## help
    
```bash
pgup [help]
```
    
Shows help info

# License

ISC

Copyright 2021 Roman Ditchuk

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.