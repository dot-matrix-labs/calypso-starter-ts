import { migrate } from './index';

await migrate();
console.log('Migration script executed successfully for CI/CD.');
process.exit(0);
