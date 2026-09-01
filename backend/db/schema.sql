-- โครงสร้างฐานข้อมูลทั้งหมดของ PayBox
--
-- ไฟล์นี้คือสภาพปัจจุบันของฐานข้อมูล ใช้ติดตั้งใหม่จากศูนย์ — import ไฟล์นี้ไฟล์เดียวจบ
-- ไม่ต้องรันอะไรใน migrations/ ตามทีหลัง
--
-- migrations/ มีไว้สำหรับระบบที่ติดตั้งไปแล้วและต้องอัปเกรดตามเท่านั้น
-- ก่อนหน้านี้ไฟล์นี้ขาดตาราง admins, audit_log และ device_commands ทำให้คนที่ติดตั้งใหม่
-- ได้ระบบที่เข้าหน้าแอดมินไม่ได้และสั่งงานเครื่องระยะไกลไม่ได้
--
-- ปิดการตรวจ foreign key ระหว่าง import เพราะตารางเรียงตามตัวอักษร ตารางลูกจึงมาก่อนตารางแม่
-- อัปเดตล่าสุด 1 กันยายน 2569

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `admin_sessions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `admin_id` int unsigned DEFAULT NULL,
  `token` varchar(64) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime NOT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `idx_token` (`token`),
  KEY `idx_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `admins` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL,
  `name` varchar(120) NOT NULL,
  `email` varchar(190) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `totp_secret` varchar(64) DEFAULT NULL,
  `totp_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `is_owner` tinyint(1) NOT NULL DEFAULT '0',
  `password_changed_at` datetime DEFAULT NULL,
  `last_login_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `admin_id` int unsigned DEFAULT NULL,
  `admin_username` varchar(64) DEFAULT NULL,
  `action` varchar(64) NOT NULL,
  `target_type` varchar(32) DEFAULT NULL,
  `target_id` varchar(64) DEFAULT NULL,
  `summary` varchar(255) DEFAULT NULL,
  `detail` json DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`),
  KEY `idx_admin` (`admin_id`),
  KEY `idx_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `customer_sessions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `customer_id` int unsigned NOT NULL,
  `token` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `fk_sessions_customer` (`customer_id`),
  KEY `idx_token` (`token`),
  CONSTRAINT `fk_sessions_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `customers` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `email` varchar(190) COLLATE utf8mb4_general_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fee_tier` varchar(12) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'percentage',
  `fee_percent` decimal(5,2) NOT NULL DEFAULT '1.00',
  `flat_fee_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `phone` varchar(32) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `totp_secret` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `totp_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `payout_bank` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `payout_account_no` varchar(32) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `payout_account_name` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `password_changed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `device_commands` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int unsigned NOT NULL,
  `command` varchar(32) NOT NULL DEFAULT 'force_update',
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `requested_by_admin_id` int unsigned DEFAULT NULL,
  `requested_by_username` varchar(64) DEFAULT NULL,
  `from_version` varchar(20) DEFAULT NULL,
  `hold_reason` varchar(190) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `dispatched_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_device_status` (`device_id`,`status`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_device_commands_device` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `devices` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `device_key` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `mac_address` varchar(17) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` datetime DEFAULT NULL,
  `firmware_version` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `shop_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PAYBOX',
  `entry_method` varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'keypad',
  `preset_amounts` varchar(255) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '5,10,20,50,100,500,1000',
  `fixed_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `op_mode` tinyint unsigned NOT NULL DEFAULT '3',
  `pulse_pin` int DEFAULT '14',
  `pulse_baht_inc` int NOT NULL DEFAULT '0',
  `ty_api` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `ty_msg` varchar(100) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Thank You!',
  `pay_inc` int NOT NULL DEFAULT '10',
  `pay_ty_msg` varchar(100) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Payment Received!',
  `banner_url_1` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `banner_url_2` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `banner_url_3` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `banner_url_4` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `banner_url_5` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `banner_idle_sec` int NOT NULL DEFAULT '20',
  `customer_id` int unsigned DEFAULT NULL,
  `region_zone` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `province` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `district` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `subdistrict` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `lat` decimal(10,7) DEFAULT NULL,
  `lng` decimal(10,7) DEFAULT NULL,
  `banner_type_1` varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'image',
  `banner_fps_1` int NOT NULL DEFAULT '8',
  `banner_frame_count_1` int NOT NULL DEFAULT '0',
  `banner_type_2` varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'image',
  `banner_fps_2` int NOT NULL DEFAULT '8',
  `banner_frame_count_2` int NOT NULL DEFAULT '0',
  `banner_type_3` varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'image',
  `banner_fps_3` int NOT NULL DEFAULT '8',
  `banner_frame_count_3` int NOT NULL DEFAULT '0',
  `banner_type_4` varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'image',
  `banner_fps_4` int NOT NULL DEFAULT '8',
  `banner_frame_count_4` int NOT NULL DEFAULT '0',
  `banner_type_5` varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'image',
  `banner_fps_5` int NOT NULL DEFAULT '8',
  `banner_frame_count_5` int NOT NULL DEFAULT '0',
  `banner_version_1` int NOT NULL DEFAULT '1',
  `banner_version_2` int NOT NULL DEFAULT '1',
  `banner_version_3` int NOT NULL DEFAULT '1',
  `banner_version_4` int NOT NULL DEFAULT '1',
  `banner_version_5` int NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `device_key` (`device_key`),
  UNIQUE KEY `mac_address` (`mac_address`),
  KEY `fk_devices_customer` (`customer_id`),
  CONSTRAINT `fk_devices_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `firmware_releases` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `version` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `filename` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `uploaded_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `version` (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `settlements` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `customer_id` int unsigned NOT NULL,
  `tx_count` int unsigned NOT NULL DEFAULT '0',
  `total_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_fee` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_net` decimal(12,2) NOT NULL DEFAULT '0.00',
  `status` varchar(12) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `proof_reference` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `proof_file` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `settled_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `note` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_customer` (`customer_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_settlements_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `transactions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `device_id` int unsigned NOT NULL,
  `payment_intent_id` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'thb',
  `status` varchar(30) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `fee_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `fee_tier_snapshot` varchar(12) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `net_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `settlement_id` int unsigned DEFAULT NULL,
  `stripe_fee_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `profit_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `payment_intent_id` (`payment_intent_id`),
  KEY `idx_status` (`status`),
  KEY `idx_device` (`device_id`),
  KEY `idx_settlement` (`settlement_id`),
  CONSTRAINT `fk_transactions_device` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`),
  CONSTRAINT `fk_transactions_settlement` FOREIGN KEY (`settlement_id`) REFERENCES `settlements` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET FOREIGN_KEY_CHECKS = 1;
