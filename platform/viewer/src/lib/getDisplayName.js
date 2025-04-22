export const getDisplayName = (user)  => {
  if (user.first_name || user.last_name) {
    return `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  }
  return user.email ?? user.username;
};
