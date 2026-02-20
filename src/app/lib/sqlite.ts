import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.resolve(process.cwd(), "src/app/db/sox.sqlite");
const dbDir = path.dirname(dbPath);

let db: Database.Database;

try {
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(dbPath);
} catch (error: any) {
    console.error("❌ Fatal error initializing database:", error);
    throw error;
}

const tableExists = (tableName: string): boolean => {
    try {
        const result = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name=?
        `).get(tableName);
        return !!result;
    } catch (error: any) {
        console.error(`Error checking if table ${tableName} exists:`, error);
        return false;
    }
};

try {
    if (!tableExists("contracts")) {
        db.exec(`
            CREATE TABLE contracts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_description TEXT NOT NULL,
                opening_value TEXT NOT NULL,
                pk_buyer TEXT NOT NULL,
                pk_vendor TEXT NOT NULL,
                price NUMBER NOT NULL,
                num_blocks INTEGER,
                num_gates INTEGER,
                commitment TEXT NOT NULL,
                tip_completion NUMBER NOT NULL,
                tip_dispute NUMBER NOT NULL,
                protocol_version NUMBER NOT NULL,
                timeout_delay NUMBER NOT NULL,
                algorithm_suite TEXT NOT NULL,
                accepted INTEGER NOT NULL,
                sponsor TEXT,
                optimistic_smart_contract TEXT,
                session_key_private TEXT,
                session_key_address TEXT
            )
        `);
        console.log("✅ Table 'contracts' created");
    }
} catch (error: any) {
    console.error("❌ Error creating table 'contracts':", error);
}

try {
    if (!tableExists("disputes")) {
        db.exec(`
            CREATE TABLE disputes (
                contract_id INTEGER UNIQUE NOT NULL,
                pk_buyer_sponsor TEXT,
                pk_vendor_sponsor TEXT,
                dispute_smart_contract TEXT,
                CONSTRAINT fk_contract_id
                    FOREIGN KEY (contract_id) 
                    REFERENCES contracts(id)
                    ON DELETE CASCADE
            )
        `);
        console.log("✅ Table 'disputes' created");
    }
} catch (error: any) {
    console.error("❌ Error creating table 'disputes':", error);
}

try {
    db.exec("ALTER TABLE contracts ADD COLUMN session_key_private TEXT");
} catch (e: any) {
    if (!e.message?.includes("duplicate column name")) {
        console.warn("Warning adding session_key_private:", e.message);
    }
}
try {
    db.exec("ALTER TABLE contracts ADD COLUMN session_key_address TEXT");
} catch (e: any) {
    if (!e.message?.includes("duplicate column name")) {
        console.warn("Warning adding session_key_address:", e.message);
    }
}

export default db;
