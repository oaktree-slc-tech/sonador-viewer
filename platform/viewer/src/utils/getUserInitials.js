export const getInitialLetters = (data) => {
  if (!data) {
    return 'N/A';
  }
  if (data.first_name || data.last_name) {
    if (data.first_name && data.last_name) {
      return `${data.first_name[0]}${data.last_name[0]}`.toUpperCase();
    }
    if (data.first_name) {
      return data.first_name.slice(0, 2).toUpperCase();
    }
    if (data.last_name) {
      return data.last_name.slice(0, 2).toUpperCase();
    }
  }
  if (data.email) {
    return data.email.slice(0, 2).toUpperCase();
  }
  if(data.username){
    return data.username.slice(0, 2).toUpperCase();
  }
};
