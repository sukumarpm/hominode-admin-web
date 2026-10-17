# Admin Web Hosting deployment

From this repository, run:

```sh
npm run deploy:hosting
```

The script builds the Admin Web application into `dist` and deploys only the
`hominode_app` Hosting target to the explicitly selected `hominode-prod`
project. In this repository, `.firebaserc` maps that target to the
`hominode-app-prod` Hosting site. Firebase CLI must be installed and
authenticated before deployment.

Do not deploy the root `lyvo1` repository's `hominode_app` target for Admin Web.
The root `firebase.json` points that target at `hominode_web/build/web`, so a
root deployment can replace the Admin Web site with that Flutter web artifact.
