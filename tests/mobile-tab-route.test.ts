import { describe, expect, it } from 'vitest';
import { chatReturnUrl, isMobileTabRoute, MOBILE_CHAT_KEY, readMobileChat, rememberMobileChat } from '../dashboard/src/mobile-tab-route';

describe('mobile tab routing', () => {
  it.each(['/achievements', '/cron', '/skills', '/files', '/config?workbench=display', '/profiles/editor', '/plugin/custom'])('wraps %s', route => expect(isMobileTabRoute(route)).toBe(true));
  it.each(['/chat', '/chat?profile=writer&session=one', '/chat?workbench=terminal', '/chat/'])('leaves %s alone', route => expect(isMobileTabRoute(route)).toBe(false));
  it('preserves conversation query and hash across tabs and tool routes', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    expect(readMobileChat(storage)).toBe('/chat');
    const chat = '/chat?profile=writer&hermesSession=sample#message';
    rememberMobileChat(chat, storage);
    for (const route of ['/skills', '/chat?workbench=terminal', '/chat?workbench=files']) rememberMobileChat(route, storage);
    expect(data.get(MOBILE_CHAT_KEY)).toBe(chat);
    expect(readMobileChat(storage)).toBe(chat);
    rememberMobileChat('/chat?profile=default&session=two', storage);
    expect(readMobileChat(storage)).toBe('/chat?profile=default&session=two');
  });
  it.each([null, '', '//evil.test/chat', '/\\evil.test/chat', 'https://evil.test/chat', '/files', '/chat?workbench=terminal'])('falls back for %s', value => expect(chatReturnUrl(value)).toBe('/chat'));
  it('removes the desktop panel marker only', () => expect(chatReturnUrl('/chat?profile=writer&session=one&panel=1')).toBe('/chat?profile=writer&session=one'));
  it('tolerates storage failures', () => {
    const storage = { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('disabled'); } };
    expect(() => rememberMobileChat('/chat?session=one', storage)).not.toThrow();
    expect(readMobileChat(storage)).toBe('/chat');
  });
});
