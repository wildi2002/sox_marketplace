DROP TABLE IF EXISTS contracts;
DROP TABLE IF EXISTS disputes;

CREATE TABLE contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_description TEXT NOT NULL,
    opening_value TEXT NOT NULL,

    -- contract elements
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
    sponsor TEXT, -- can be null while the sponsor hasn't been found
    optimistic_smart_contract TEXT, -- can be null while the sponsor hasn't been found
    session_key_private TEXT, -- nullable, only for vendor flow
    session_key_address TEXT -- nullable
);

CREATE TABLE disputes (
    contract_id INTEGER UNIQUE NOT NULL,
    pk_buyer_sponsor TEXT,
    pk_vendor_sponsor TEXT,
    dispute_smart_contract TEXT,
    CONSTRAINT fk_contract_id
        FOREIGN KEY (contract_id) 
        REFERENCES contracts(id)
        ON DELETE CASCADE
);
