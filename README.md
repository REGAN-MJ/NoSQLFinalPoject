
## Sign-in

- During local development (when `NODE_ENV` is not `production`), the app opens directly as the administrator and listens only on `127.0.0.1`. Set `NODE_ENV=production` to require sign-in and allow normal network hosting.
- **Administrator:** username `admin`, password `admin123` by default. The account is inserted into MongoDB on first startup with a bcrypt-hashed password. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` before first startup to use different credentials; changing them after the account exists does not update it.
- **Student:** registration number or email address and password. New student signups are held as pending profiles until an administrator completes their academic details; pending accounts cannot sign in. Student passwords are stored as bcrypt hashes.

