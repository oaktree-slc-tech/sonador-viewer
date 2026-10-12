import { InMemoryWebStorage, User, WebStorageStateStore } from 'oidc-client';

import getUserManagerForOpenIdConnectClient from './getUserManagerForOpenIdConnectClient.js';
import { beginSignOut, endSignOut } from './signOutLatch';
import {
  REFUSED,
  RENEWED,
  STALE,
  sessionRenewal,
  sonadorRenewUrl,
  whenSignedIn,
} from './sonadorAccessToken.js';

// The real user manager, its access token timers and its storage
jest.unmock('redux-oidc');

const AUTHORITY = 'http://sonador.example.com:8070/auth/openid/';
const RENEW_URL = 'http://sonador.example.com:8070/silent-refresh.html';

function now() {
  return Math.floor(Date.now() / 1000);
}

function createUserManager() {
  return getUserManagerForOpenIdConnectClient(
    { dispatch: jest.fn() },
    {
      authority: AUTHORITY,
      client_id: 'viewer',
      redirect_uri: 'http://viewer.example.com/callback',
      monitorSession: false,
      userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    }
  );
}

async function signIn(userManager, { token = 'current-token', lifetime = 3600 } = {}) {
  await userManager.storeUser(
    new User({ access_token: token, token_type: 'Bearer', profile: {}, expires_at: now() + lifetime })
  );

  // As at startup: reading the user arms the access token timers
  await userManager.getUser();
}

function deferred() {
  let resolve;
  const promise = new Promise(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

async function storedToken(userManager) {
  const user = await userManager._loadUser();
  return user && user.access_token;
}

beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  delete global.fetch;
  endSignOut();
});

describe('sonadorRenewUrl', () => {
  it('is the renew endpoint at the root of the authority origin', () => {
    expect(sonadorRenewUrl(AUTHORITY)).toBe(RENEW_URL);
  });
});

describe('session renewal', () => {
  it('renews with the current token and loads the renewed user', async () => {
    const userManager = createUserManager();
    await signIn(userManager);
    const loaded = jest.fn();
    userManager.events.addUserLoaded(loaded);
    global.fetch.mockResolvedValue(response(200, { access_token: 'renewed-token', expires_in: 7200 }));

    await expect(sessionRenewal(userManager).renew()).resolves.toBe(RENEWED);

    expect(global.fetch).toHaveBeenCalledWith(RENEW_URL, {
      headers: { Authorization: 'Bearer current-token' },
      credentials: 'omit',
    });
    expect(await storedToken(userManager)).toBe('renewed-token');
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(loaded.mock.calls[0][0].expires_in).toBeGreaterThan(7100);
  });

  it('shares one attempt between concurrent callers', async () => {
    const userManager = createUserManager();
    await signIn(userManager);
    global.fetch.mockResolvedValue(response(200, { access_token: 'renewed-token', expires_in: 7200 }));

    const results = await Promise.all([
      sessionRenewal(userManager).renew(),
      sessionRenewal(userManager).renew(),
    ]);

    expect(results).toEqual([RENEWED, RENEWED]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a refused session without silent sign-in, and does not retry it', async () => {
    const userManager = createUserManager();
    await signIn(userManager);
    const silent = jest.spyOn(userManager, 'signinSilent').mockResolvedValue({});
    global.fetch.mockResolvedValue(response(403));

    await expect(sessionRenewal(userManager).renew()).resolves.toBe(REFUSED);
    await expect(sessionRenewal(userManager).renew()).resolves.toBe(REFUSED);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(silent).not.toHaveBeenCalled();
    expect(await storedToken(userManager)).toBe('current-token');
  });

  it('does not retry through the expiry notification window when the session is refused', async () => {
    const userManager = createUserManager();
    await signIn(userManager, { lifetime: 50 });
    const silent = jest.spyOn(userManager, 'signinSilent');
    global.fetch.mockResolvedValue(response(403));

    // Other code reading the user re-arms the timers each second; renewal must still run once
    for (let second = 0; second < 10; second += 1) {
      await jest.advanceTimersByTimeAsync(1000);
      await userManager.getUser();
    }

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(silent).not.toHaveBeenCalled();
  });

  it('does not store a token whose session ends within the notification window', async () => {
    const userManager = createUserManager();
    await signIn(userManager);
    global.fetch.mockResolvedValue(response(200, { access_token: 'renewed-token', expires_in: 30 }));

    await expect(sessionRenewal(userManager).renew()).resolves.toBe(REFUSED);
    expect(await storedToken(userManager)).toBe('current-token');
  });

  describe('a renewal that completes after the user changed', () => {
    async function pendingRenewal(userManager) {
      await signIn(userManager);
      const reply = deferred();
      global.fetch.mockReturnValue(reply.promise);

      const loaded = jest.fn();
      const silent = jest.spyOn(userManager, 'signinSilent');
      userManager.events.addUserLoaded(loaded);

      const result = sessionRenewal(userManager).renew();
      await jest.advanceTimersByTimeAsync(0);

      return { reply, result, loaded, silent };
    }

    const replies = [
      ['a successful', () => response(200, { access_token: 'renewed-token', expires_in: 7200 })],
      ['a refused', () => response(403)],
    ];

    describe.each(replies)('with %s response', (_, reply) => {
      it('stores nothing after the user was removed', async () => {
        const userManager = createUserManager();
        const pending = await pendingRenewal(userManager);

        await userManager.removeUser();
        pending.reply.resolve(reply());

        await expect(pending.result).resolves.toBe(STALE);
        expect(await storedToken(userManager)).toBe(null);
        expect(pending.loaded).not.toHaveBeenCalled();
        expect(pending.silent).not.toHaveBeenCalled();
      });

      it('stores nothing after a newer user replaced it', async () => {
        const userManager = createUserManager();
        const pending = await pendingRenewal(userManager);

        await userManager.storeUser(
          new User({ access_token: 'newer-token', token_type: 'Bearer', profile: {}, expires_at: now() + 3600 })
        );
        pending.reply.resolve(reply());

        await expect(pending.result).resolves.toBe(STALE);
        expect(await storedToken(userManager)).toBe('newer-token');
        expect(pending.loaded).not.toHaveBeenCalled();
        expect(pending.silent).not.toHaveBeenCalled();
      });

      it('stores nothing once sign-out has begun', async () => {
        const userManager = createUserManager();
        const pending = await pendingRenewal(userManager);

        beginSignOut();
        pending.reply.resolve(reply());

        await expect(pending.result).resolves.toBe(STALE);
        expect(await storedToken(userManager)).toBe('current-token');
        expect(pending.loaded).not.toHaveBeenCalled();
        expect(pending.silent).not.toHaveBeenCalled();
      });
    });
  });
});

describe('whenSignedIn', () => {
  function createStore(user) {
    let state = { oidc: { user } };
    const listeners = [];

    return {
      getState: () => state,
      subscribe: listener => {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
      setUser: next => {
        state = { oidc: { user: next } };
        listeners.slice().forEach(listener => listener());
      },
      listeners,
    };
  }

  it('resolves at once with a current user', async () => {
    const user = { access_token: 'token', expired: false };

    await expect(whenSignedIn(createStore(user))).resolves.toBe(user);
  });

  it('waits for a current user and then unsubscribes', async () => {
    const store = createStore({ access_token: 'stale', expired: true });
    const signedIn = whenSignedIn(store);

    const user = { access_token: 'token', expired: false };
    store.setUser(user);

    await expect(signedIn).resolves.toBe(user);
    expect(store.listeners).toHaveLength(0);
  });
});
