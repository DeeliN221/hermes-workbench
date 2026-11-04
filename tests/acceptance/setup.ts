import { execFileSync } from 'node:child_process';
export default function setup() {
  execFileSync('python3', ['scripts/local-stack.py', 'check'], { stdio: 'inherit' });
}
