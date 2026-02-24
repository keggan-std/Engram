#!/usr/bin/env node
// One-shot script: update Claude Code MCP config to use local dev build
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const configPath = join(homedir(), '.claude.json');
const localBuild = join(homedir(), 'Documents', 'MCP Builder', 'Engram', 'dist', 'index.js');

const config = JSON.parse(readFileSync(configPath, 'utf8'));

config.mcpServers.engram = {
  type: 'stdio',
  command: 'node',
  args: [localBuild]
};

writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

const verify = JSON.parse(readFileSync(configPath, 'utf8'));
console.log('✓ Engram MCP config updated:');
console.log(JSON.stringify(verify.mcpServers.engram, null, 2));
console.log('\nRestart Claude Code to activate v1.5.0.');
