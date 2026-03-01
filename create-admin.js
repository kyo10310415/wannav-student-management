import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query } from './src/db/connection.js';

/**
 * Create initial admin user
 * Usage: node create-admin.js <email> [password]
 */
async function createAdmin() {
  const email = process.argv[2] || 'admin@example.com';
  const password = process.argv[3] || '1111';
  
  console.log(`Creating admin user: ${email}`);
  
  try {
    // Check if user already exists
    const existingUser = await query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (existingUser.rows.length > 0) {
      console.log('❌ User already exists');
      process.exit(1);
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create user
    const result = await query(
      'INSERT INTO users (email, password_hash, role, must_change_password) VALUES ($1, $2, $3, $4) RETURNING id, email, role',
      [email, passwordHash, 'admin', true]
    );
    
    console.log('✅ Admin user created successfully:');
    console.log(`   Email: ${result.rows[0].email}`);
    console.log(`   Role: ${result.rows[0].role}`);
    console.log(`   Password: ${password}`);
    console.log('   Must change password on first login: yes');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    process.exit(1);
  }
}

createAdmin();
