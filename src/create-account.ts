/** Administrator accounts only. Evaluators are read live from ERP, not manually provisioned. */
import 'dotenv/config';
import { AccountModel, connectModels } from './models/schemas/index.js';
import { hashPassword } from './services/auth.service.js';
const [role, username, password, ...extra] = process.argv.slice(2);
if (role !== 'admin' || !username || !password) {
  console.error('Usage: npm run account:create -- admin <username> <password> [display name]');
  process.exit(1);
}
try {
  const { salt, hash } = hashPassword(password);
  await connectModels();
  await AccountModel.updateOne({ username: username.trim().toUpperCase() }, {
    $set: { role: 'admin', displayName: extra.join(' ') || 'LMS Administrator', department: '',
      passwordSalt: salt, passwordHash: hash, active: true },
  }, { upsert: true, runValidators: true });
  console.log('Administrator account saved:', username.toUpperCase());
  process.exit(0);
} catch (error) {
  console.error('Administrator setup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
