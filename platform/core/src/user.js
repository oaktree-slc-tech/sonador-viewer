// User instance for OHIF viewer. Treated as a singleton global that can be imported
// into classes and functions for representing the active user instance.


let user = {
  userLoggedIn: () => false,
  getUserId: () => null,
  getName: () => null,
  getAccessToken: () => null,
  login: () => new Promise((resolve, reject) => reject()),
  logout: () => new Promise((resolve, reject) => reject()),
  getData: (key) => null,
  setData: (key, value) => null,
};


export default user;
