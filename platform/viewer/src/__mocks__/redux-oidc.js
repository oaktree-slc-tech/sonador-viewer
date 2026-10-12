const createUserManager = settings => ({
  settings,
  events: { addAccessTokenExpiring: jest.fn() },
  storeUser: jest.fn(),
});
const loadUser = () => jest.fn();

export { createUserManager, loadUser };
