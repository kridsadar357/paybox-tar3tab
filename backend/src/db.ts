// เชื่อมต่อ MySQL ผ่าน connection pool — ทดแทน lib/db.php (PDO) เดิม
import mysql from 'mysql2/promise';
import { config } from './config';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true, // ให้ DECIMAL คอลัมน์กลับมาเป็น number ไม่ใช่ string (ต่างจาก PDO default)
});
