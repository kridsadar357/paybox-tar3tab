-- paybox-api database schema
-- Import this once via phpMyAdmin / `mysql -u user -p dbname < schema.sql`

CREATE TABLE IF NOT EXISTS devices (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    device_key VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NULL,
    firmware_version VARCHAR(20) NULL,
    mac_address VARCHAR(17) NULL UNIQUE,
    shop_name VARCHAR(100) NOT NULL DEFAULT '357 PAYBOX',
    entry_method VARCHAR(10) NOT NULL DEFAULT 'keypad',
    preset_amounts VARCHAR(255) NOT NULL DEFAULT '5,10,20,50,100,500,1000',
    op_mode TINYINT UNSIGNED NOT NULL DEFAULT 3,
    pulse_pin INT NULL DEFAULT 14,
    pulse_baht_inc INT NOT NULL DEFAULT 0,
    ty_api VARCHAR(255) NULL,
    ty_msg VARCHAR(100) NOT NULL DEFAULT 'Thank You!',
    pay_inc INT NOT NULL DEFAULT 10,
    pay_ty_msg VARCHAR(100) NOT NULL DEFAULT 'Payment Received!',
    banner_url_1 VARCHAR(255) NULL,
    banner_url_2 VARCHAR(255) NULL,
    banner_url_3 VARCHAR(255) NULL,
    banner_url_4 VARCHAR(255) NULL,
    banner_url_5 VARCHAR(255) NULL,
    banner_idle_sec INT NOT NULL DEFAULT 20,
    banner_type_1 VARCHAR(10) NOT NULL DEFAULT 'image',
    banner_type_2 VARCHAR(10) NOT NULL DEFAULT 'image',
    banner_type_3 VARCHAR(10) NOT NULL DEFAULT 'image',
    banner_type_4 VARCHAR(10) NOT NULL DEFAULT 'image',
    banner_type_5 VARCHAR(10) NOT NULL DEFAULT 'image',
    banner_fps_1 INT NOT NULL DEFAULT 8,
    banner_fps_2 INT NOT NULL DEFAULT 8,
    banner_fps_3 INT NOT NULL DEFAULT 8,
    banner_fps_4 INT NOT NULL DEFAULT 8,
    banner_fps_5 INT NOT NULL DEFAULT 8,
    banner_frame_count_1 INT NOT NULL DEFAULT 0,
    banner_frame_count_2 INT NOT NULL DEFAULT 0,
    banner_frame_count_3 INT NOT NULL DEFAULT 0,
    banner_frame_count_4 INT NOT NULL DEFAULT 0,
    banner_frame_count_5 INT NOT NULL DEFAULT 0,
    banner_version_1 INT NOT NULL DEFAULT 1,
    banner_version_2 INT NOT NULL DEFAULT 1,
    banner_version_3 INT NOT NULL DEFAULT 1,
    banner_version_4 INT NOT NULL DEFAULT 1,
    banner_version_5 INT NOT NULL DEFAULT 1,
    customer_id INT UNSIGNED NULL,
    region_zone VARCHAR(30) NULL,
    province VARCHAR(100) NULL,
    district VARCHAR(100) NULL,
    subdistrict VARCHAR(100) NULL,
    lat DECIMAL(10,7) NULL,
    lng DECIMAL(10,7) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fee_tier VARCHAR(12) NOT NULL DEFAULT 'percentage',
    fee_percent DECIMAL(5,2) NOT NULL DEFAULT 1.00,
    flat_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    theme_color VARCHAR(7) NOT NULL DEFAULT '#14B8A6',
    background_type VARCHAR(10) NOT NULL DEFAULT 'color',
    background_color VARCHAR(7) NOT NULL DEFAULT '#0F172A',
    background_image VARCHAR(255) NULL,
    -- โปรไฟล์ + ความปลอดภัย + บัญชีรับเงิน (หน้า "ตั้งค่า" ของ Customer Portal)
    phone VARCHAR(32) NULL,
    totp_secret VARCHAR(64) NULL,          -- base32 secret ของ TOTP (ตั้งตอนเริ่มผูก 2FA)
    totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
    payout_bank VARCHAR(64) NULL,
    payout_account_no VARCHAR(32) NULL,
    payout_account_name VARCHAR(120) NULL,
    password_changed_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_sessions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    customer_id INT UNSIGNED NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    CONSTRAINT fk_sessions_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
    INDEX idx_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ออกโดย POST /api/admin/login หลังเช็ค admin_password ครั้งเดียว — กัน password หลุดไปอยู่ใน
-- query string ของทุก request (access log ของ reverse proxy, browser history)
CREATE TABLE IF NOT EXISTS admin_sessions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(64) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    INDEX idx_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS firmware_releases (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(20) NOT NULL UNIQUE,
    filename VARCHAR(255) NOT NULL,
    notes TEXT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settlements (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    customer_id INT UNSIGNED NOT NULL,
    tx_count INT UNSIGNED NOT NULL DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_net DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(12) NOT NULL DEFAULT 'pending',
    proof_reference VARCHAR(255) NULL,
    proof_file VARCHAR(255) NULL,
    settled_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_settlements_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
    INDEX idx_customer (customer_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS transactions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    device_id INT UNSIGNED NOT NULL,
    payment_intent_id VARCHAR(64) NOT NULL UNIQUE,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'thb',
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    fee_tier_snapshot VARCHAR(12) NULL,
    net_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    stripe_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    profit_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    settlement_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_transactions_device FOREIGN KEY (device_id) REFERENCES devices(id),
    CONSTRAINT fk_transactions_settlement FOREIGN KEY (settlement_id) REFERENCES settlements(id),
    INDEX idx_status (status),
    INDEX idx_device (device_id),
    INDEX idx_settlement (settlement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
