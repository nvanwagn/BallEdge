// Forgot your password? Run on the server:
//   npm run reset-password -- <username> <new-password>
const { db } = require('../src/db');
const { setPassword } = require('../src/auth');

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.log('Usage: npm run reset-password -- <username> <new-password>');
  const users = db.prepare('SELECT username FROM users').all();
  console.log('Existing users:', users.map((u) => u.username).join(', ') || '(none)');
  process.exit(1);
}
if (password.length < 10) { console.error('Password must be at least 10 characters.'); process.exit(1); }
const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (!user) { console.error(`No user named "${username}".`); process.exit(1); }
setPassword(user.id, password);
console.log(`Password updated for ${username}. All existing sessions were signed out.`);
