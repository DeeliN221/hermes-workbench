/**
 * Minimal native host boundary, using Hermes' pinned React/router versions.
 * Mirrors the URL -> profile and profile -> URL effects plus unknown-route
 * redirect from web/src/{contexts/ProfileProvider,App}.tsx at upstream commit
 * a55c972e09177e4db3934915e329993858b247d6. There are no network/auth calls here.
 * Mount before the plugin: starting the router after Workbench canonicalizes
 * the URL hides the cold-navigation race.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BrowserRouter, useLocation, useSearchParams, Routes, Route, Navigate } from 'react-router';

window.React = React;
window.ReactDOM = { createRoot };

function ProfileProvider({ children }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();
  const [profile, setProfile] = React.useState(() => searchParams.get('profile') ?? '');
  const urlProfile = searchParams.get('profile');
  React.useEffect(() => {
    if (urlProfile !== null && urlProfile !== profile) setProfile(urlProfile);
  }, [urlProfile]);
  React.useEffect(() => {
    if ((profile || '') === (searchParams.get('profile') ?? '')) return;
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      if (profile) next.set('profile', profile);
      else next.delete('profile');
      return next;
    }, { replace: true });
  }, [pathname, profile]);
  return <>
    <div key={profile || '__own__'}>
      <Routes>
        <Route path="/sessions" element={null} />
        <Route path="/chat" element={null} />
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </div>
    <span id="hermes-profile-switcher" hidden>{profile || 'default'}</span>
    {children}
  </>;
}

let showApp;
function Host() {
  const [app, setApp] = React.useState(null);
  showApp = setApp;
  return <BrowserRouter><ProfileProvider>{app}</ProfileProvider></BrowserRouter>;
}
const root = createRoot(document.getElementById('root'));
flushSync(() => root.render(<Host />));
// The existing mock host registers the overlay later, after loading Workbench.
window.ReactDOM.createRoot = () => ({ render: app => showApp(app) });
