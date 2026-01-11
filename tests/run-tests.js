import { readdirSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { stats } from './test-helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = join(__dirname, '..');
const testsDir = __dirname;

// Simple recursive finder
function getFiles(dir) {
    const dirents = readdirSync(dir, { withFileTypes: true });
    const files = dirents.map((dirent) => {
        const res = join(dir, dirent.name);
        if (dirent.isDirectory()) {
            return getFiles(res);
        }
        return res;
    });
    return Array.prototype.concat(...files);
}

async function run() {
    console.log('🚀 Starting MTG Calculator Test Suite\n');
    
    const allFiles = getFiles(testsDir);
    const testFiles = allFiles.filter(f => f.endsWith('.test.js') && !f.includes('run-tests.js'));
    
    for (const file of testFiles) {
        const relativePath = relative(testsDir, file);
        try {
            await import('file://' + file.replace(/\\/g, '/'));
        } catch (error) {
            console.error(`\n❌ Fatal Error in ${relativePath}:`);
            console.error(error);
            stats.failed++;
            process.exitCode = 1;
        }
    }

    console.log('\n----------------------------------------');
    console.log(`📊 Summary: ${stats.suites} suites run.`);
    console.log(`   ✅ ${stats.passed} assertions passed`);
    console.log(`   ❌ ${stats.failed} assertions failed`);
    console.log('----------------------------------------\n');
    
    if (stats.failed > 0) {
        process.exit(1);
    }
}

run();
