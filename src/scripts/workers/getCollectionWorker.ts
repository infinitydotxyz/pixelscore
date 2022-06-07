import { expose } from 'threads/worker';

expose({
  hashPassword(password, salt) {
    return `${password + salt}`;
  }
});
