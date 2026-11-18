// Account admin from the server's shell.
//   node src/users.js add you@example.com [--admin] [--name "Your Name"]   -> prints a temporary password
//   node src/users.js reset you@example.com                                  -> new temporary password
//   node src/users.js list | disable <email> | enable <email> | remove <email>
const { db } = require('./db');
const { createUser, setPassword, tempPassword } = require('./auth');
const [cmd, email] = process.argv.slice(2);
const flag = f => process.argv.includes(f);
const find = () => db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase()) || (console.error('No such user: ' + email), process.exit(1));
if (cmd === 'add') {
  const i = process.argv.indexOf('--name');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(String(email).toLowerCase())) { console.log(`${email} already exists (use: reset)`); process.exit(0); }
  console.log(`Created ${email}${flag('--admin') ? ' (admin)' : ''}. Temporary password: ${createUser(email, { role: flag('--admin') ? 'admin' : 'user', name: i > 0 ? process.argv[i + 1] : null })}`);
} else if (cmd === 'reset') { const p = tempPassword(); setPassword(find().id, p, true); console.log(`Temporary password for ${email}: ${p}`); }
else if (cmd === 'disable' || cmd === 'enable') { db.prepare('UPDATE users SET disabled=? WHERE id=?').run(cmd === 'disable' ? 1 : 0, find().id); if (cmd === 'disable') db.prepare('DELETE FROM sessions WHERE user_id=?').run(find().id); console.log('ok'); }
else if (cmd === 'remove') { const u = find(); db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); db.prepare('DELETE FROM users WHERE id=?').run(u.id); console.log('removed'); }
else if (cmd === 'list') console.table(db.prepare('SELECT email,role,disabled,must_change,last_login FROM users ORDER BY email').all());
else console.log('usage: node src/users.js add|reset|disable|enable|remove <email> [--admin] | list');
