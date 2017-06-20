/**
 * middleware_mod - @module to authenticate and validate
 * requests, call firebase module, and handles errors
 */

const FS = require('fs');
const LOG = require('./log_mod');
const ERROR = require('./error_mod');
const MEDIA = require('./media_mod');
const FIREBASE = require('./firebase_mod');
const AUTH = require('./authentication_mod');

/**
 * authenticate - Authorizes a user and generates a JSON web token for the user
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var authenticate = function(_request, _response, _callback) {
  const SOURCE = 'authenticate()';
  log(SOURCE, _request);

  // Check request parameters
  let missingParams = [];
  if (_request.body.username === undefined) missingParams.push('username');
  if (_request.body.password === undefined) missingParams.push('password');
  if (missingParams.length > 0) {
    let errorJson = ERROR.error(
      SOURCE,
      _request,
      _response,
      ERROR.CODE.INVALID_REQUEST_ERROR,
      `Invalid parameters: ${missingParams.join()}`
    );

    _callback(errorJson);
  } else {
    // Parameters are valid, so check if a password exists for that username
    FIREBASE.GET(
      `/passwords/${_request.body.username}`,
      (hashedPassword) => {
        if (hashedPassword === null) {
          let errorJson = ERROR.error(
            SOURCE,
            _request,
            _response,
            ERROR.CODE.LOGIN_ERROR,
            null,
            `'${_request.body.username}' does not exists in passwords table`
          );

          _callback(errorJson);
        } else {
          // Password exists in the database, so compare them
          AUTH.validatePasswords(
            _request.body.password,
            hashedPassword,
            (passwordsMatch) => {
              if (!passwordsMatch) {
                let errorJson = ERROR.error(
                  SOURCE,
                  _request,
                  _response,
                  ERROR.CODE.LOGIN_ERROR,
                  null,
                  `'${_request.body.password}' does not match ${_request.body.username}'s password`
                );

                _callback(errorJson);
              } else {
                FIREBASE.GET(
                  `/users/${_request.body.username}`,
                  (userData) => {
                    if (userData === null) {
                      // Username does not exist in the users table
                      let errorJson = ERROR.error(
                        SOURCE,
                        _request,
                        _response,
                        ERROR.CODE.RESOURCE_DNE_ERROR,
                        null,
                        `User '${_request.body.username}' does not exist`
                      );

                      _callback(errorJson);
                    } else {
                      // Generate the JWT for the client request
                      let token = AUTH.generateToken(_request.body.username, userData);
                      let successJson = {
                        success: {
                          token: `JWT ${token}`,
                        }
                      };

                      _callback(successJson);
                    }
                  },
                  (getUserError) => {
                    // Failed retrieving user from the users table
                    let errorJson = ERROR.determineFirebaseError(
                      SOURCE,
                      _request,
                      _response,
                      getUserError,
                      'username'
                    );

                    _callback(errorJson);
                  }
                );
              }
            },
            (comparePasswordsError) => {
              let errorJson = ERROR.determineBcryptError(
                _SOURCE,
                _request,
                _response,
                comparePasswordsError
              );

              _callback(errorJson);
            }
          );
        }
      },
      (getPasswordError) => {
        // Failed retrieving password from passwords table for that user
        let errorJson = ERROR.determineFirebaseError(
          SOURCE,
          _request,
          _response,
          getPasswordError,
          'username'
        );

        _callback(errorJson);
      }
    );
  }
};

/**
 * createUser - Adds a user and all their data to the database
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var createUser = function(_request, _response, _callback) {
  const SOURCE = 'createUser()';
  log(SOURCE, _request);

  // Check request paramerters
  let invalidParams = [];
  if (!isValidEmail(_request.body.email)) invalidParams.push('password');
  if (!isValidUsername(_request.body.username)) invalidParams.push('username');
  if (!isValidPassword(_request.body.password)) invalidParams.push('password');

  if (invalidParams.length > 0) {
    let errorJson = ERROR.error(
      SOURCE,
      _request,
      _response,
      ERROR.CODE.INVALID_REQUEST_ERROR,
      `Invalid parameters: ${invalidParams.join()}`
    );

    _callback(errorJson);
  } else {
    // Parameters are valid, so check if username already exists
    FIREBASE.GET(
      `/users/'${_request.body.username}`,
      (existingUser) => {
        // Check if username already exists
        if (existingUser !== null) {
          // That username already exists
          let errorJson  = ERROR.error(
            SOURCE,
            _request,
            _response,
            ERROR.CODE.RESOURCE_ERROR,
            'That username is already taken',
          );

          _callback(errorJson);
        } else {
           // Username is not taken. Create a JSON with the request parameters
           let newUserInfo = { email: _request.body.email.trim() };

          /**
           * Set user record in the users table. The key is the
           * username and the value is the user information JSON
           */
          FIREBASE.UPDATE(
            `/users/${_request.body.username.trim()}`,
            newUserInfo,
            () => {
              // Hash the password
              AUTH.hash(
                _request.body.password.trim(),
                (hashedPassword) => {
                  // Sucessfully hashed password
                  FIREBASE.UPDATE(
                    `/passwords/${_request.body.username}`,
                    hashedPassword,
                    () => {
                      /**
                       * Password was successfully added to the passwords
                       * table. Generate a JWT for the client and send success
                       */
                      let token = AUTH.generateToken(_request.body.username.trim(), newUserInfo);
                      let successJson = {
                        success: {
                          message: 'Successfully created user',
                          token: `JWT ${token}`,
                        }
                      };

                      _response.status(201);
                      _callback(successJson);
                    },
                    (setPasswordError) => {
                      // Failed to add password to database. Remove the user
                      removeUser(
                        _request.body.username,
                        () => {
                          let errorJson = ERROR.error(
                            SOURCE,
                            _request,
                            _response,
                            ERROR.CODE.API_ERROR,
                            null,
                            setPasswordError
                          );

                          _callback(errorJson);
                        },
                        (removeUserError) => {
                          let errorJson = ERROR.error(
                            SOURCE,
                            _request,
                            _response,
                            ERROR.CODE.API_ERROR,
                            null,
                            removeUserError
                          );

                          _callback(errorJson);
                        }
                      );
                    }
                  );
                },
                (hashError) => {
                  // Failed to hash the password. Remove the user
                  removeUser(
                    _request.body.username,
                    () => {
                      let errorJson = ERROR.error(
                        SOURCE,
                        _request,
                        _response,
                        ERROR.CODE.API_ERROR,
                        null,
                        hashError
                      );

                      _callback(errorJson);
                    },
                    (removeUserError) => {
                      let errorJson = ERROR.determineFirebaseError(
                        SOURCE,
                        _request,
                        _response,
                        ERROR.CODE.API_ERROR,
                        null,
                        removeUserError
                      );

                      _callback(errorJson);
                    }
                  );
                }
              );
            },
            (setUserError) => {
              // Failed to add the user to the database
              let errorJson = ERROR.determineFirebaseError(
                SOURCE,
                _request,
                _response,
                setUserError,
                'username'
              );

              _callback(errorJson);
            }
          );
        }
      },
      (checkUserError) => {
        // Failed while checking if username already existed
        let errorJson = ERROR.determineFirebaseError(
          SOURCE,
          _request,
          _response,
          checkUserError,
          'username'
        );

        _callback(errorJson);
      }
    );
  }
};

/**
 * getUser - Retrieves a user from the database
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var getUser = function(_request, _response, _callback) {
  const SOURCE = 'getUser()';
  log(SOURCE, _request)

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      if (!isValidUsername(_request.params.username)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: username'
        );

        _callback(errorJson);
      } else {
        // Parameters are valid so get the user's info
        FIREBASE.GET(
          `/users/${_request.params.username}`,
          (userData) => {
            if (userData === null) {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That user does not exist'
              );

              _callback(errorJson);
            } else {
              // Remove the private information from the user JSON
              delete userData.email
              delete userData.follow_requests;
              delete userData.follower_requests;

              _callback(userData);
            }
          },
          (getUserError) => {
            // Failed while checking if username already existed
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getUserError,
              'username'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * updateUserEmail - Updates a user's email in the database
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var updateUserEmail = function(_request, _response, _callback) {
  const SOURCE = 'updateUserEmail()';
  log(SOURCE, _request)

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      let invalidParams = [];
      if (!isValidUsername(_request.params.username)) invalidParams.push('username');
      if (!isValidEmail(_request.body.newEmail)) invalidParams.push('newEmail');

      if (invalidParams.length > 0){
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          `Invalid parameters: ${invalidParams.join()}`
        );

        _callback(errorJson);
      } else if (client.username !== _request.params.username) {
        // Client attempted to delete a user other than themselves
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'You cannot update another user\'s email',
          `${user.username} tried to update ${_request.params.username}'s email`
        );

        _callback(errorJson);
      } else {
        // Parameters are valid so get the user's info
        FIREBASE.GET(
          `/users/${_request.params.username}`,
          (userData) => {
            if (userData === null) {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That user does not exist'
              );

              _callback(errorJson);
            } else if (userData.email === _request.body.newEmail.trim()) {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.INVALID_REQUEST_ERROR,
                'Unchanged parameters: newEmail'
              );

              _callback(errorJson);
            } else {
              FIREBASE.UPDATE(
                `/users/${client.username}/email`,
                _request.body.newEmail.trim(),
                () => {
                  let successJson = {
                    success: {
                      message: 'Successfully updated email',
                    }
                  };

                  _callback(successJson);
                },
                (updateEmailError) => {
                  let errorJson = ERROR.determineFirebaseError(
                    SOURCE,
                    _request,
                    _response,
                    updateEmailError
                  );

                  _callback(errorJson);
                }
              );
            }
          },
          (getUserError) => {
            // Failed while retrieving existing user
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getUserError,
              'username'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * updateUserPassword - Updates a user's password in the database
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var updateUserPassword = function(_request, _response, _callback) {
  const SOURCE = 'updateUserPassword()';
  log(SOURCE, _request)

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      let invalidParams = [];
      if (!isValidUsername(_request.params.username)) invalidParams.push('username');
      if (!isValidPassword(_request.body.oldPassword)) invalidParams.push('oldPassword');
      if (!isValidPassword(_request.body.newPassword)) invalidParams.push('newPassword');

      if (invalidParams.length > 0){
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          `Invalid parameters: ${invalidParams.join()}`
        );

        _callback(errorJson);
      } else if (client.username !== _request.params.username) {
        // Client attempted to delete a user other than themselves
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'You cannot update another user\'s password',
          `${user.username} tried to update ${_request.params.username}'s password`
        );

        _callback(errorJson);
      } else {
        // Parameters are valid so get the user's password
        FIREBASE.GET(
          `/passwords/${_request.params.username}`,
          (existingPassword) => {
            if (existingPassword === null) {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That user does not exist'
              );

              _callback(errorJson);
            } else {
              AUTH.validatePasswords(
                _request.body.oldPassword.trim(),
                existingPassword,
                (passwordsMatch) => {
                  if (!passwordsMatch) {
                    let errorJson = ERROR.error(
                      SOURCE,
                      _request,
                      _response,
                      ERROR.CODE.INVALID_REQUEST_ERROR,
                      'oldPassword does not match existing password'
                    );

                    _callback(errorJson);
                  } else {
                    // Client knows their old password, so check if new password is unchanged
                    if (_request.body.newPassword.trim() === _request.body.oldPassword.trim()) {
                      let errorJson = ERROR.error(
                        SOURCE,
                        _request,
                        _response,
                        ERROR.CODE.INVALID_REQUEST_ERROR,
                        'Unchanged parameters: newPassword'
                      );

                      _callback(errorJson);
                    } else {
                      // New password is different from old password
                      AUTH.hash(
                        _request.body.newPassword.trim(),
                        (hashedPassword) => {
                          FIREBASE.UPDATE(
                            `/passwords/${client.username}`,
                            hashedPassword,
                            () => {
                              let successJson = {
                                success: {
                                  message: 'Successfully updated password',
                                }
                              };

                              _callback(successJson);
                            },
                            (updatePasswordError) => {
                              let errorJson = ERROR.determineFirebaseError(
                                SOURCE,
                                _request,
                                _response,
                                updatePasswordError
                              );

                              _callback(errorJson);
                            }
                          );
                        },
                        (hashPasswordError) => {
                          let errorJson = ERROR.determineBcryptError(
                            SOURCE,
                            _request,
                            _response,
                            hashPasswordError
                          );

                          _callback(errorJson);
                        }
                      );
                    }
                  }
                },
                (validatePasswordsError) => {
                  let errorJson = ERROR.determineBcryptError(
                    SOURCE,
                    _request,
                    _response,
                    validatePasswordsError
                  );

                  _callback(errorJson);
                }
              );
            }
          },
          (getUserError) => {
            // Failed while retrieving existing user
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getUserError,
              'username'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * deleteUser - Deletes a user and their dropps from the database
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var deleteUser = function(_request, _response, _callback) {
  const SOURCE = 'deleteUser()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Check request parameters
      if (!isValidUsername(_request.params.username)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: username'
        );

        _callback(errorJson);
      } else if (client.username !== _request.params.username) {
        // Client attempted to delete a user other than themselves
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'You cannot delete another user',
          `${user.username} tried to delete ${_request.params.username}`
        );

        _callback(errorJson);
      } else {
        // Request is valid, so query database for user info
        FIREBASE.GET(
          `/users/${_request.params.username}`,
          (userInfo) => {
            if (userInfo === null) {
              /**
               * That username does not exist in the database. This should honestly
               * never happen, unless two devices signed into the same account
               * both tried to delete the account at the same time. Then maybe
               */
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That user does not exist'
              );

              _callback(errorJson);
            } else {
              // TODO: Make the removal process synchronous

              // Delete all follower requests for client
              if (userInfo.follower_requests !== null) {
                for (let requester in userInfo.follower_requests) {
                  removeRequest(
                    client.username,
                    'follower',
                    requester,
                    'follow',
                    () => {},
                    removeFollowerRequestError => (
                      log(`${SOURCE}: Failed removing follower request (${follower}) for ${client.username} because ${removeFollowerRequestError}`)
                    )
                  );
                }
              }

              // Delete all follow requests for client
              if (userInfo.follow_requests !== null) {
                for (let requestedUser in userInfo.follow_requests) {
                  removeRequest(
                    client.username,
                    'follow',
                    requestedUser,
                    'follower',
                    () => {},
                    removeFollowRequestError => (
                      log(`${SOURCE}: Failed removing follow request (${requestedUser}) for ${client.username} because ${removeFollowRequestError}`)
                    )
                  );
                }
              }

              // Delete all followers
              if (userInfo.followers !== null) {
                for (let follower in userInfo.followers) {
                  removeConnection(
                    client.username,
                    'followers',
                    follower,
                    'follows',
                    () => {},
                    removeFollowerError => (
                      log(`${SOURCE}: Failed removing follower (${follower}) for ${client.username} because ${removeFollowerError}`)
                    )
                  );
                }
              }

              // Delete all follows
              if (userInfo.follows !== null) {
                for (let followedUser in userInfo.follows) {
                  removeConnection(
                    client.username,
                    'follows',
                    followedUser,
                    'followers',
                    () => {},
                    removeFollowError => (
                      log(`${SOURCE}: Failed removing follow (${followedUser}) for ${client.username} because ${removeFollowError}`)
                    )
                  );
                }
              }

              // Delete all dropps
              // FIXME: Stop querying db for ALL dropps. Use firebase filtering
              FIREBASE.GET(
                '/dropps',
                (allDropps) => {
                  // Loop over all dropps by their id
                  for (let droppKey in allDropps) {
                    // If the poster matches this user, delete the dropp
                    if (allDropps[droppKey].username === client.username) {
                      FIREBASE.DELETE(
                        `/dropps/${droppKey}`,
                        () => {
                          // If dropp had image, delete the image
                          if (allDropps[droppKey].media === 'true') {
                            MEDIA.deleteImage(
                              droppKey,
                              deleted => {},
                              deleteImageError => (
                                log(`${SOURCE}: Failed deleting image '${droppKey}' because ${deleteImageError}`)
                              )
                            );
                          }
                        },
                        deleteDroppError => (
                          log(`${SOURCE}: Failed deleting dropp '${droppKey}' because ${deleteDroppError}`)
                        )
                      );
                    }
                  }

                  // Now delete the username and password
                  removeUser(
                    client.username,
                    () => {
                      let successJson = {
                        success: {
                          message: 'Successfully deleted all user data',
                        }
                      };

                      FIREBASE.DELETE(
                        `/passwords/${client.username}`,
                        () => _callback(successJson),
                        (deletePasswordError) => {
                          log(`${SOURCE}: Failed deleting password for ${client.username} because ${deletePasswordError}`);
                          _callback(successJson);
                        }
                      );
                    },
                    (removeUserError) => {
                      log(`${SOURCE}: VERY BAD. DELETED ALL USER DATA BUT NOT USER ACCOUNT (${client.username}) because ${removeUserError}`);
                      let errorJson = ERROR.determineFirebaseError(
                        SOURCE,
                        _request,
                        _response,
                        removeUserError
                      );

                      _callback(errorJson);
                    }
                  );
                },
                (getDroppsError) => {
                  let errorJson = ERROR.determineFirebaseError(
                    SOURCE,
                    _request,
                    _response,
                    getDroppsError,
                  );

                  _callback(errorJson);
                }
              );
            }
          },
          (getUserError) => {
            // Failed while retrieving user info
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getUserError,
              'username'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * createDropp - Adds a dropp to the database
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var createDropp = function(_request, _response, _callback) {
  const SOURCE = 'createDropp()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Check request parameters
      let invalidParams = [];
      if (!isValidLocation(_request.body.location)) invalidParams.push('location');
      if (
        !isValidInteger(_request.body.timestamp) ||
        _request.body.timestamp > (Date.now() / 1000)
      ) invalidParams.push('timestamp');
      if (!isValidMedia(_request.body.media)) invalidParams.push('media');
      if (
        isValidMedia(_request.body.media) &&
        _request.body.media === 'false' &&
        !isValidTextPost(_request.body.text)
      ) invalidParams.push('text');

      if (invalidParams.length > 0) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          `Invalid parameters: ${invalidParams.join()}`
        );

        _callback(errorJson);
      } else {
        // All parameters and content are valid, so build dropp JSON
        let dropp = {
          location: _request.body.location.replace(/\s/g, '').trim(),
          timestamp: parseInt(_request.body.timestamp),
          username: client.username,
          text: _request.body.text === undefined ? '' : _request.body.text.trim(),
          media: _request.body.media,
        };

        // Add dropp to database
        FIREBASE.ADD(
          '/dropps',
          dropp,
          (droppUrl) => {
            let droppKey = droppUrl.toString().split('/').pop();
            _response.status(201);
            _callback({ droppId: droppKey });
          },
          (addDroppError) => {
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              addDroppError
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * addImage - Uploads an image to google cloud storage
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the result
 */
var addImage = function(_request, _response, _callback) {
  const SOURCE = 'addImage()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Check request parameters
      if (!isValidId(_request.params.droppId)) {
        // Remove temp file that multer created
        if (_request.file !== undefined) removeFile(_request.file.path);
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: droppId'
        );

        _callback(errorJson);
      } else {
        // Parameters are valid, so query database
        FIREBASE.GET(
          `/dropps/${_request.params.droppId}`,
          (dropp) => {
            if (dropp === null) {
              // Remove temp file that multer created
              if (_request.file !== undefined) removeFile(_request.file.path);
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That dropp does not exist'
              );

              _callback(errorJson);
            } else if (client.username !== dropp.username) {
              // Client attempted to add an image for a user other than themself
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.INVALID_REQUEST_ERROR,
                'You cannot add an image for another user'
              );

              _callback(errorJson);
            } else if (dropp.media === 'false') {
              /**
               * If dropp has media parameter = false, don't allow an
               * image upload. Remove the temp file that multer created
               */
              if (_request.file !== undefined) removeFile(_request.file.path);

              // Send response to client
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.INVALID_REQUEST_ERROR,
                'That dropp can\'t have media attached'
              );

              _callback(errorJson);
            } else {
              /**
               * Dropp exists in database and is supposed to have
               * media. Check if request body contains file param
               */
              if (_request.file !== undefined) {
                // Make sure only specific image files are in the request body data
                if (
                  _request.file.mimetype !== 'image/jpeg' &&
                  _request.file.mimetype !== 'image/png'
                ) {
                  // Delete the temp file that multer created
                  removeFile(_request.file.path);
                  let errorJson = ERROR.error(
                    SOURCE,
                    _request,
                    _response,
                    ERROR.CODE.INVALID_MEDIA_TYPE,
                    null,
                    `File received had ${_request.file.mimetype} mimetype`
                  );

                  _callback(errorJson);
                } else {
                  /**
                   * Valid file has been sent with request. Access file that multer
                   * added to temp directory and stream it to google cloud storage
                   */
                  let filename = _request.params.droppId;
                  let localReadStream = FS.createReadStream(_request.file.path);
                  let remoteWriteStream = MEDIA.bucket.file(filename).createWriteStream();
                  localReadStream.pipe(remoteWriteStream);

                  // Catch error event while uploading
                  remoteWriteStream.on('error', (uploadError) => {
                     // Remove temp file that multer created
                    removeFile(_request.file.path);
                    let errorJson = ERROR.error(
                      SOURCE,
                      _request,
                      _response,
                      ERROR.CODE.API_ERROR,
                      null,
                      uploadError
                    );

                    _callback(errorJson);
                  });

                  // Catch finish event after uploading
                  remoteWriteStream.on('finish', () => {
                     // Remove temp file that multer created
                    removeFile(_request.file.path);
                    let successJson = {
                      success: {
                        message: 'Successfully added image',
                      }
                    };

                    _response.status(201);
                    _callback(successJson);
                  });
                }
              } else {
                let errorJson = ERROR.error(
                  SOURCE,
                  _request,
                  _response,
                  ERROR.CODE.INVALID_REQUEST_ERROR,
                  'Missing parameters: file'
                );

                _callback(errorJson);
              }
            }
          },
          (getDroppError) => {
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getDroppError,
              'droppId'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * getDropp - Retrieves a dropp from the database
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var getDropp = function(_request, _response, _callback) {
  const SOURCE = 'getDropp()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Check request parameters
      if (!isValidId(_request.params.droppId)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: droppId'
        );

        _callback(errorJson);
      } else {
        // Parameters are valid, so query database
        FIREBASE.GET(
          `/dropps/${_request.params.droppId}`,
          (dropp) => {
            if (dropp === null) {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That dropp does not exist'
              );

              _callback(errorJson);
            } else _callback(dropp);
          },
          (getDroppError) => {
            // Failed to fetch the dropp
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getDroppError,
              'droppId'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * getImage - Downloads an image from google cloud storage
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the result
 */
var getImage = function(_request, _response, _callback) {
  const SOURCE = 'getImage()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Check request parameters
      if (!isValidId(_request.params.droppId)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: droppId'
        );

        _callback(errorJson);
      } else {
        // Parameters are valid, so check if dropp in firebase has media value as true
        FIREBASE.GET(
          `/dropps/${_request.params.droppId}`,
          (dropp) => {
            if (dropp === null) {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That dropp does not exist'
              );

              _callback(errorJson);
            } else if (dropp.media === 'false') {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That dropp has no media'
              );

              _callback(errorJson);
            } else {
              // Requested dropp has media, so query google cloud storage for image
              let filename = _request.params.droppId;
              let remoteReadStream = MEDIA.bucket.file(filename).createReadStream();

              // Determine if image should be sent as base-64 string for react-native clients
              let platformIsReactNative = _request.headers !== undefined &&
                _request.headers.platform === 'React-Native';

              // Catch error event while downloading
              remoteReadStream.on('error', (downloadError) => {
                var error, clientMessage, serverLog;
                if (downloadError.code === 404) {
                  error = ERROR.CODE.RESOURCE_DNE_ERROR;
                  clientMessage = 'That image does not exist';
                } else {
                  error = ERROR.CODE.API_ERROR;
                  clientMessage = null;
                  serverLog = downloadErr;
                }

                let errorJson = ERROR.error(
                  SOURCE,
                  _request,
                  _response,
                  error,
                  clientMessage,
                  serverLog
                );

                _callback(errorJson);
              });

              // Download bytes from google cloud storage reference to local memory array
              let data = [];
              remoteReadStream.on('data', datum => data.push(datum));

              // Catch finish event after downloading has finished
              remoteReadStream.on('end', () => {
                // Create buffer object from array of bytes
                let buffer = Buffer.concat(data);

                if (platformIsReactNative) {
                  encodeForReactNative(buffer, base64String => _callback({ media: base64String }));
                } else _callback({ media: buffer });
              });
            }
          },
          (getDroppError) => {
            // Failed to get the dropp
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getDroppError,
              'droppId'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * getAllDropps - Retrieves all dropps from the database
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var getAllDropps = function(_request, _response, _callback) {
  const SOURCE = 'getAllDropps()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      let invalidParams = [];
      if (!isValidLocation(_request.body.location)) invalidParams.push('location');
      if (!isValidPositiveFloat(_request.body.maxDistance)) invalidParams.push('maxDistance');

      if (invalidParams.length > 0) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          `Invalid parameters: ${invalidParams.join()}`
        );

        _callback(errorJson);
      } else {
        // Request parameters are valid. Get client's follows
        FIREBASE.GET(
          `/users/${client.username}/follows`,
          (usersClientFollows) => {
            if (usersClientFollows === null) usersClientFollows = {};

            // Now get all the dropps
            FIREBASE.GET(
              '/dropps',
              (allDropps) => {
                // Save dropps that are within maxDistance of client or if client follows poster
                let subsetOfDropps = {};
                let maxDistance = Number(_request.body.maxDistance);
                let targetLocation = _request.body.location.trim().split(',').map(Number);

                // Loop over all the dropps in the dropps JSON
                for (let droppKey in allDropps) {
                  let dropp = allDropps[droppKey];
                  if (!isValidLocation(dropp.location)) continue;

                  // Turn the string lat,long coordinates into a number array
                  let droppLocation = dropp.location.split(',').map(Number);

                  // Calculate straight-path distance between the points
                  let distanceFromTarget = distance(targetLocation, droppLocation);

                  if (usersClientFollows[dropp.username] !== undefined) {
                    if (distanceFromTarget <= maxDistance) dropp.nearby = 'true';
                    else dropp.nearby = 'false';
                    subsetOfDropps[droppKey] = dropp;
                  } else if (distanceFromTarget <= maxDistance) {
                    dropp.nearby = 'true';
                    subsetOfDropps[droppKey] = dropp;
                  }
                }

                _callback(subsetOfDropps);
              },
              (getDroppsError) => {
                let errorJson = ERROR.determineFirebaseError(
                  SOURCE,
                  _request,
                  _response,
                  getDroppsError
                );

                _callback(errorJson);
              }
            );
          },
          (getUsersClientFollowsError) => {
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getUsersClientFollowsError
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * getDroppsByLocation - Retrieves all dropps from the database near a location
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var getDroppsByLocation = function(_request, _response, _callback) {
  const SOURCE = 'getDroppsByLocation()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Check request parameters
      let invalidParams = [];
      if (!isValidLocation(_request.body.location)) invalidParams.push('location');
      if (!isValidPositiveFloat(_request.body.maxDistance)) invalidParams.push('maxDistance');

      if (invalidParams.length > 0) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          `Invalid parameters: ${invalidParams.join()}`
        );

        _callback(errorJson);
      } else {
        // Query the database
        FIREBASE.GET(
          '/dropps',
          (allDropps) => {
            // Filter out the dropps that are further than the max distance
            try {
              getCloseDropps(
                allDropps,
                _request.body.location.trim(),
                _request.body.maxDistance,
                closeDropps => _callback(closeDropps)
              );
            } catch (getCloseDroppsError) {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.API_ERROR,
                null,
                getCloseDroppsError
              );

              _callback(errorJson);
            }
          },
          (getDroppsError) => {
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getDroppsError
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * getDroppsByUser - Retrieves all dropps from the database posted by a user
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var getDroppsByUser = function(_request, _response, _callback) {
  const SOURCE = 'getDroppsByUser()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Check request parameters
      if (!isValidUsername(_request.params.username)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: username'
        );

        _callback(errorJson);
      } else {
        // If the client is requesting their own dropps, don't check the client's follows
        if (_request.params.username === client.username) {
          // FIXME: Stop querying db for ALL dropps. Use firebase filtering
          FIREBASE.GET(
            '/dropps',
            (allDropps) => {
              let droppsByUser = {};

              // Loop over all dropps by their id
              for (let droppKey in allDropps) {
                // If the poster matches the requested username, save the dropp
                if (allDropps[droppKey].username === client.username) {
                  droppsByUser[droppKey] = allDropps[droppKey];
                }
              }

              _callback(droppsByUser);
            },
            (getDroppsError) => {
              let errorJson = ERROR.determineFirebaseError(
                SOURCE,
                _request,
                _response,
                getDroppsError
              );

              _callback(errorJson);
            }
          );
        } else {
          // Client is requesting another user's dropps, so verify that client follows that user
          FIREBASE.GET(
            `/users/${client.username}/follows`,
            (usersClientFollows) => {
              if (
                usersClientFollows === null ||
                usersClientFollows[_request.params.username] === undefined
              ) {
                let errorJson = ERROR.error(
                  SOURCE,
                  _request,
                  _response,
                  ERROR.CODE.INVALID_REQUEST_ERROR,
                  'You must follow that user to get their dropps'
                );

                _callback(errorJson);
              } else {
                // The client follows the requested user, so get all dropps posted by that user
                // FIXME: Stop querying db for ALL dropps. Use firebase filtering
                FIREBASE.GET(
                  '/dropps',
                  (allDropps) => {
                    let droppsByUser = {};

                    // Loop over all dropps by their id
                    for (let droppKey in allDropps) {
                      // If the poster matches the requested username, save the dropp
                      if (allDropps[droppKey].username === _request.params.username) {
                        droppsByUser[droppKey] = allDropps[droppKey];
                      }
                    }

                    _callback(droppsByUser);
                  },
                  (getDroppsError) => {
                    let errorJson = ERROR.determineFirebaseError(
                      SOURCE,
                      _request,
                      _response,
                      getDroppsError
                    );

                    _callback(errorJson);
                  }
                );
              }
            },
            (getUsersClientFollowsError) => {
              let errorJson = ERROR.determineFirebaseError(
                SOURCE,
                _request,
                _response,
                getUsersClientFollowsError
              );

              _callback(errorJson);
            }
          );
        }
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * getDroppsByFollows - Retrieves all dropps posted by users that a specific user follows
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var getDroppsByFollows = function(_request, _response, _callback) {
  const SOURCE = 'getDroppsByFollows()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      if (!isValidUsername(_request.params.username)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: username'
        );

        _callback(errorJson);
      } else if (client.username !== _request.params.username) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'You cannot access dropps posted by another user\'s follows'
        );

        _callback(errorJson);
      } else {
        // Request parameters are valid. Get the users that the client follows
        FIREBASE.GET(
          `/users/${client.username}/follows`,
          (usersClientFollows) => {
            if (usersClientFollows === null) _callback({});
            else {
              // The client follows at least one user, so get all the dropps
              // FIXME: Stop querying db for ALL dropps. Use firebase filtering
              FIREBASE.GET(
                '/dropps',
                (allDropps) => {
                  let droppsByFollows = {};

                  // Loop over all dropps by their id
                  for (let droppKey in allDropps) {
                    // If the user follows the poster of the dropp, save the dropp
                    let poster = allDropps[droppKey].username;
                    if (usersClientFollows[poster] !== undefined) {
                      droppsByFollows[droppKey] = allDropps[droppKey];
                    }
                  }

                  _callback(droppsByFollows);
                },
                (getDroppsError) => {
                  let errorJson = ERROR.determineFirebaseError(
                    SOURCE,
                    _request,
                    _response,
                    getDroppsError
                  );

                  _callback(errorJson);
                }
              );
            }
          },
          (getUsersClientFollowsError) => {
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getUsersClientFollowsError
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * updateDroppText - Updates a dropp's text content in the database
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var updateDroppText = function(_request, _response, _callback) {
  const SOURCE = 'updateDroppText()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Check request parameters
      let invalidParams = [];
      if (!isValidId(_request.params.droppId)) invalidParams.push('droppId');
      if (_request.body.newText === undefined) invalidParams.push('newText');

      if (invalidParams.length > 0) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          `Invalid parameters: ${invalidParams.join()}`
        );

        _callback(errorJson);
      } else {
        // Request parameters are valid, so query database for the dropp
        FIREBASE.GET(
          `/dropps/${_request.params.droppId}`,
          (dropp) => {
            if (dropp === null) {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That dropp does not exist'
              );

              _callback(errorJson);
            } else if (client.username !== dropp.username) {
              // Client attempted to update dropp that they did not post
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.INVALID_REQUEST_ERROR,
                'You cannot update another user\'s dropp',
                `${client.username} tried to update ${dropp.username}'s dropp (${_request.params.droppId})`
              );

              _callback(errorJson);
            } else if (dropp.media === 'false' && !isValidTextPost(_request.body.newText)) {
              // Client attempted to remove text from a dropp with no media
                let errorJson = ERROR.error(
                  SOURCE,
                  _request,
                  _response,
                  ERROR.CODE.INVALID_REQUEST_ERROR,
                  `Text cannot be empty for this dropp`
                );

                _callback(errorJson);
            } else if (dropp.text === _request.body.newText.trim()) {
              // Useless update to the text because they are identical
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.INVALID_REQUEST_ERROR,
                'You cannot update a dropp with the same text'
              );

              _callback(errorJson);
            } else {
              // Update is valid, so update dropp in the database
              FIREBASE.UPDATE(
                `/dropps/${_request.params.droppId}/text`,
                _request.body.newText.trim(),
                () => {
                  let successJson = {
                    success: {
                      message: 'Successfully updated dropp',
                    }
                  };

                  _callback(successJson);
                },
                (updateError) => {
                  // Failed while updating dropp
                  let errorJson = ERROR.determineFirebaseError(
                    SOURCE,
                    _request,
                    _response,
                    updateError,
                    'droppId'
                  );

                  _callback(errorJson);
                }
              );
            }
          },
          (getDroppError) => {
            // Failed to fetch the dropp
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getDroppError,
              'droppId'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * deleteDropp - Deletes a dropp from the database
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the reuslt
 */
var deleteDropp = function(_request, _response, _callback) {
  const SOURCE = 'deleteDropp()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Check request parameters
      if (!isValidId(_request.params.droppId)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: droppId'
        );

        _callback(errorJson);
      } else {
        // Request parameters are valid, so query database for the dropp
        FIREBASE.GET(
          `/dropps/${_request.params.droppId}`,
          (dropp) => {
            if (dropp === null) {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That dropp does not exist'
              );

              _callback(errorJson);
            } else if (client.username !== dropp.username) {
              // Client attempted to delete dropp that they did not post
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.INVALID_REQUEST_ERROR,
                'You cannot delete another user\'s dropp',
                `${client.username} tried to delete ${dropp.username}'s dropp (${_request.params.droppId})`
              );

              _callback(errorJson);
            } else {
              // Client posted this dropp, so try to delete it
              FIREBASE.DELETE(
                `/dropps/${_request.params.droppId}`,
                () => {
                  // Create success JSON because dropp was deleted
                  let successJson = {
                    success: {
                      message: 'Successfully deleted dropp',
                    }
                  };

                  // Check if the dropp had media
                  if (dropp.media === 'true') {
                    // Attempt to delete media from cloud storage
                    MEDIA.deleteImage(
                      _request.params.droppId,
                      deleted => _callback(successJson),
                      (deleteImageError) => {
                        log(`${SOURCE}: Unable to delete image ${_request.params.droppId} because ${deleteImageError}`);
                        _callback(successJson);
                      }
                    );
                  } else _callback(successJson);
                },
                (deleteDroppError) => {
                  // Failed while deleting dropp
                  let errorJson = ERROR.determineFirebaseError(
                    SOURCE,
                    _request,
                    _response,
                    deleteDroppError,
                    'droppId'
                  );

                  _callback(errorJson);
                }
              );
            }
          },
          (getDroppError) => {
            // Failed to fetch the dropp
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getDroppError,
              'droppId'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * requestToFollow - Sends a follow request for a user on behalf of the client
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the result
 */
var requestToFollow = function(_request, _response, _callback) {
  const SOURCE = 'requestToFollow()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      if (!isValidUsername(_request.params.username)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: username'
        );

        _callback(errorJson);
      } else if (_request.params.username === client.username) {
        // Client attempted to follow themselves
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'You cannot follow yourself',
          `${client.username} tried to follow themself`
        );

        _callback(errorJson);
      } else {
        // Parameters are valid so query database to see if requested user exists
        FIREBASE.GET(
          `/users/${_request.params.username}`,
          (requestedUser) => {
            if (requestedUser === null) {
              // Requested user does not exist
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That user does not exist'
              );

              _callback(errorJson);
            } else {
              // Requested user exists. Check if client already follows user
              FIREBASE.GET(
                `/users/${client.username}/follows/${_request.params.username}`,
                (requestedUserName) => {
                  if (requestedUserName !== null) {
                    // Client already follows requested user
                    let errorJson = ERROR.error(
                      SOURCE,
                      _request,
                      _response,
                      ERROR.CODE.RESOURCE_ERROR,
                      'You already follow that user'
                    );

                    _callback(errorJson);
                  } else {
                    /**
                     * Client doesn't already follow requested user.
                     * Check if client still has a request to follow user
                     */
                     FIREBASE.GET(
                       `/users/${client.username}/follow_requests/${_request.params.username}`,
                       (requestedUserFollowRequest) => {
                         if (requestedUserFollowRequest !== null) {
                           // Client already follows requested user
                           let errorJson = ERROR.error(
                             SOURCE,
                             _request,
                             _response,
                             ERROR.CODE.RESOURCE_ERROR,
                             'You still have an active follow request for that user'
                           );

                           _callback(errorJson);
                         } else {
                           /**
                           * Client can send request to user. Add
                           * request to client's follow requests first
                           */
                          FIREBASE.UPDATE(
                            `/users/${client.username}/follow_requests/${_request.params.username}`,
                            _request.params.username,
                            () => {
                              /**
                               * Successfully added follow request to client's profile.
                               * Now add follower request to requested user's profile
                               */
                              FIREBASE.UPDATE(
                                `/users/${_request.params.username}/follower_requests/${client.username}`,
                                client.username,
                                () => {
                                  // Follow request was successfully saved for client and requested user
                                  let successJson = {
                                    success: {
                                      message: 'Successfully sent follow request',
                                    }
                                  };

                                  _callback(successJson);
                                },
                                (addFollowerRequestError) => {
                                  /**
                                   * Adding the follower request for the requested user failed. We must remove
                                   * the client's follow request from their profile to maintain consistency
                                   */
                                  FIREBASE.DELETE(
                                    `/users/${client.username}/follow_requests/${_request.params.username}`,
                                    () => {
                                      let errorJson = ERROR.determineFirebaseError(
                                        SOURCE,
                                        _request,
                                        _response,
                                        addFollowerRequestError
                                      );

                                      _callback(errorJson);
                                    },
                                    (removeFollowRequestError) => {
                                      let errorJson = ERROR.determineFirebaseError(
                                        SOURCE,
                                        _request,
                                        _response,
                                        removeFollowRequestError
                                      );

                                      _callback(errorJson);
                                    }
                                  );
                                }
                              );
                            },
                            (addFollowRequestError) => {
                              let errorJson = ERROR.determineFirebaseError(
                                SOURCE,
                                _request,
                                _response,
                                addFollowRequestError
                              );

                              _callback(errorJson);
                            }
                          );
                         }
                       },
                       (getRequestedUserFollowRequestError) => {
                        let errorJson = ERROR.determineFirebaseError(
                          SOURCE,
                          _request,
                          _response,
                          getRequestedUserFollowRequestError,
                        );

                        _callback(errorJson);
                       }
                     );
                  }
                },
                (getRequestedUserFollowError) => {
                  let errorJson = ERROR.determineFirebaseError(
                    SOURCE,
                    _request,
                    _response,
                    getRequestedUserFollowError,
                    'username'
                  );

                  _callback(errorJson);
                }
              );
            }
          },
          (getRequestedUserInfoError) => {
            // Failed while checking if requested user exists
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getRequestedUserInfoError,
              'username'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * getFollowers - Retrieves a user's followers
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the result
 */
var getFollowers = function(_request, _response, _callback) {
  const SOURCE = 'getFollowers()';
  log(SOURCE, _request);

  // Verify the client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      if (!isValidUsername(_request.params.username)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: username'
        );

        _callback(errorJson);
      } else {
        // Request parameters are valid, so get requested user's followers
        try {
          getConnections(
            _request.params.username,
            'followers',
            followers => _callback(followers),
            (getConnectionsError) => {
              let errorJson = ERROR.determineFirebaseError(
                SOURCE,
                _request,
                _response,
                getConnectionsError
              );

              _callback(errorJson);
            }
          );
        } catch(getConnectionsTypeError) {
          // Event occurs if type 'followers' is not accepted by getConnections()
          let errorJson = ERROR.error(
            SOURCE,
            _request,
            _response,
            ERROR.CODE.API_ERROR,
            null,
            getConnectionsTypeError
          );

          _callback(errorJson);
        }
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * getFollows - Retrieves a user's follows
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the result
 */
var getFollows = function(_request, _response, _callback) {
  const SOURCE = 'getFollows()';
  log(SOURCE, _request);

  // Verify the client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      if (!isValidUsername(_request.params.username)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: username'
        );

        _callback(errorJson);
      } else {
        // Request parameters are valid, so get requested user's follows
        try {
          getConnections(
            _request.params.username,
            'follows',
            follows => _callback(follows),
            (getConnectionsError) => {
              let errorJson = ERROR.determineFirebaseError(
                SOURCE,
                _request,
                _response,
                getConnectionsError
              );

              _callback(errorJson);
            }
          );
        } catch(getConnectionsTypeError) {
          // Event occurs if type 'follows' is not accepted by getConnections()
          let errorJson = ERROR.error(
            SOURCE,
            _request,
            _response,
            ERROR.CODE.API_ERROR,
            null,
            getConnectionsTypeError
          );

          _callback(errorJson);
        }
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * getFollowerRequests - Retrieves a user's follower requests
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the result
 */
var getFollowerRequests = function(_request, _response, _callback) {
  const SOURCE = 'getFollowerRequests()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      if (!isValidUsername(_request.params.username)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: username'
        );

        _callback(errorJson);
      } else if (_request.params.username !== client.username) {
        // Client attempted to view requests of a different profile
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'You cannot view another user\'s follower requests'
        );

        _callback(errorJson);
      } else {
        // Parameters are valid, so get the client's follower requests
        try {
          getRequests(
            'follower',
            client.username,
            followerRequests => _callback(followerRequests),
            (getRequestsError) => {
              let errorJson = ERROR.determineFirebaseError(
                SOURCE,
                _request,
                _response,
                getRequestsError
              );

              _callback(errorJson);
            }
          );
        } catch(getRequestsTypeError) {
          // Event occurs if type 'follower' is not accepted by getRequests()
          let errorJson = ERROR.error(
            SOURCE,
            _request,
            _response,
            ERROR.CODE.API_ERROR,
            null,
            getRequestsTypeError
          );

          _callback(errorJson);
        }
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * getFollowRequests - Retrieves a user's follow requests
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the result
 */
var getFollowRequests = function(_request, _response, _callback) {
  const SOURCE = 'getFollowRequests()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      if (!isValidUsername(_request.params.username)) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'Invalid parameters: username'
        );

        _callback(errorJson);
      } else if (_request.params.username !== client.username) {
        // Client attempted to view requests of a different profile
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'You cannot view another user\'s follower requests'
        );

        _callback(errorJson);
      } else {
        // Parameters are valid, so get the client's follower requests
        try {
          getRequests(
            'follow',
            client.username,
            followRequests => _callback(followRequests),
            (getRequestsError) => {
              let errorJson = ERROR.determineFirebaseError(
                SOURCE,
                _request,
                _response,
                getRequestsError
              );

              _callback(getRequestsError);
            }
          );
        } catch(getRequestsTypeError) {
          // Event occurs if type 'follow' is not accepted by getRequests()
          let errorJson = ERROR.error(
            SOURCE,
            _request,
            _response,
            ERROR.CODE.API_ERROR,
            null,
            getRequestsTypeError
          );

          _callback(errorJson);
        }
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * respondToFollowerRequest - Process the acceptance or decline of a client's
 * follower request. If the client accepts, the follower will be added to
 * the client's followers and the follower will have the client added to
 * their follows. If the client declines, nothing will happen to the client's
 * followers or the requester's follows.Regardless of accepting or declining
 * the request, the follower request will be removed from the client's follower
 * requests and the client will be removed from the requester's follow requests
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the result
 */
var respondToFollowerRequest = function(_request, _response, _callback) {
  const SOURCE = 'respondToFollowerRequest()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      let invalidParams = [];
      if (!isValidUsername(_request.params.username)) invalidParams.push('username');
      if (!isValidUsername(_request.params.requestingUser)) invalidParams.push('requestingUser');

      if (invalidParams.length > 0) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          `Invalid parameters: ${invalidParams.join()}`
        );

        _callback(errorJson);
      } else if (_request.params.username !== client.username) {
        // Client is trying to respond to a request on behalf of another user
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'You cannot access another user\'s follower requests'
        );

        _callback(errorJson);
      } else {
        // Parameters are valid, so query database for follower request
        FIREBASE.GET(
          `/users/${client.username}/follower_requests/${_request.params.requestingUser}`,
          (requestingUserName) => {
            // If requestingUserName is null, there is no follower request for that user
            if (requestingUserName === null) {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That follower request does not exist'
              );

              _callback(errorJson);
            } else {
              // Follower request is valid, check if requesting user exists
              FIREBASE.GET(
                `/users/${requestingUserName}`,
                (requestingUserInfo) => {
                  if (requestingUserInfo === null) {
                    /**
                     * Requesting user doesn't exist. Remove request
                     * from client's requests and send failure
                     */
                    FIREBASE.DELETE(
                      `/users/${client.username}/follower_requests/${requestingUserName}`,
                      () => {
                        let errorJson = ERROR.error(
                          SOURCE,
                          _request,
                          _response,
                          ERROR.CODE.RESOURCE_DNE_ERROR,
                          'The user for that follower request no longer exists'
                        );

                        _callback(errorJson);
                      },
                      (deleteRequestError) => {
                        let errorJson = ERROR.determineFirebaseError(
                          SOURCE,
                          _request,
                          _response,
                          deleteRequestError
                        );

                        _callback(errorJson);
                      }
                    );
                  } else {
                    // Requesting user exists
                    if (_request.method === 'PUT') {
                      // Client wants to accept the request
                      addConnection(
                        client.username,
                        requestingUserName,
                        () => {
                          /**
                           * The requester now follows the client.
                           * Remove the requests for both users
                           */
                          removeRequest(
                            client.username,
                            'follower',
                            requestingUserName,
                            'follow',
                            () => {
                              let successJson = {
                                success: {
                                  message: 'Successfully accepted follower request',
                                }
                              };

                              _callback(successJson);
                            },
                            (removeRequestError) => {
                              let errorJson = ERROR.determineFirebaseError(
                                SOURCE,
                                _request,
                                _response,
                                removeRequestError
                              );

                              _callback(errorJson);
                            }
                          );
                        },
                        (addConnectionError) => {
                          let errorJson = ERROR.determineFirebaseError(
                            SOURCE,
                            _request,
                            _response,
                            addConnectionError
                          );

                          _callback(errorJson);
                        }
                      );
                    } else if (_request.method === 'DELETE') {
                      // Client wants to decline the request
                      removeRequest(
                        client.username,
                        'follower',
                        requestingUserName,
                        'follow',
                        () => {
                          let successJson = {
                            success: {
                              message: 'Successfully declined follower request',
                            }
                          };

                          _callback(successJson);
                        },
                        (removeRequestError) => {
                          let errorJson = ERROR.determineFirebaseError(
                            SOURCE,
                            _request,
                            _response,
                            removeRequestError
                          );

                          _callback(errorJson);
                        }
                      );
                    } else {
                      /**
                       * This block should never be reached because the
                       * router should only have routes for PUT and DELETE
                       */
                      let errorJson = ERROR.error(
                        SOURCE,
                        _request,
                        _response,
                        ERROR.CODE.INVALID_REQUEST_ERROR,
                        'Invalid method type. Must be PUT or DELETE'
                      );

                      _callback(errorJson);
                    }
                  }
                },
                (getRequestingUserInfoError) => {
                  // Failed while retrieving user info for follower request
                  let errorJson = ERROR.determineFirebaseError(
                    SOURCE,
                    _request,
                    _response,
                    getRequestingUserInfoError
                  );

                  _callback(errorJson);
                }
              );
            }
          },
          (getFollowerRequestError) => {
            // Failed while retrieving follower request
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getFollowerRequestError,
              'requestingUser'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * removeFollowRequest - Removes a pending follow request. The
 * client will no longer have a request to follower another user.
 * That user will no longer have a follower request from the client
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the result
 */
var removeFollowRequest = function(_request, _response, _callback) {
  const SOURCE = 'removeFollowRequest()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      let invalidParams = [];
      if (!isValidUsername(_request.params.username)) invalidParams.push('username');
      if (!isValidUsername(_request.params.requestedUser)) invalidParams.push('requestedUser');

      if (invalidParams.length > 0) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          `Invalid parameters: ${invalidParams.join()}`
        );

        _callback(errorJson);
      } else if (_request.params.username !== client.username) {
        // Client is trying to respond to a request on behalf of another user
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'You cannot access another user\'s requests'
        );

        _callback(errorJson);
      } else {
        // Parameters are valid, so query database for the follow request
        FIREBASE.GET(
          `/users/${client.username}/follow_requests/${_request.params.requestedUser}`,
          (requestedUserName) => {
            if (requestedUserName === null) {
              // Request id for that follow does not exist
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That follow request does not exist'
              );

              _callback(errorJson);
            } else {
              // Request id is valid, so retrive user associated with follow request
              FIREBASE.GET(
                `/users/${requestedUserName}`,
                (requestedUserInfo) => {
                  if (requestedUserInfo === null) {
                    /**
                     * User assocaited with follow request does not
                     * exist. Still attempt to delete follow request
                     */
                    FIREBASE.DELETE(
                      `/users/${client.username}/follow_requests/${requestedUserName}`,
                      () => {
                        let successJson = {
                          success: {
                            message: 'Successfully removed pending follow request',
                          }
                        };

                        _callback(successJson);
                      },
                      (removeFollowRequestError) => {
                        // Failed while deleting follow request for client
                        let errorJson = ERROR.determineFirebaseError(
                          SOURCE,
                          _request,
                          _response,
                          removeFollowRequestError
                        );

                        _callback(errorJson);
                      }
                    );
                  } else {
                    removeRequest(
                      client.username,
                      'follow',
                      requestedUserName,
                      'follower',
                      () => {
                        let successJson = {
                          success: {
                            message: 'Successfully removed pending follow request',
                          }
                        };

                        _callback(successJson);
                      },
                      (removeRequestError) => {
                        // Failed while deleting follow request for client
                        let errorJson = ERROR.determineFirebaseError(
                          SOURCE,
                          _request,
                          _response,
                          removeRequestError
                        );

                        _callback(errorJson);
                      }
                    );
                  }
                },
                (getRequestedUserError) => {
                  // Failed retrieving user associated with that follow request
                  let errorJson = ERROR.determineFirebaseError(
                    SOURCE,
                    _request,
                    _response,
                    getRequestedUserError
                  );

                  _callback(errorJson);
                }
              );
            }
          },
          (getFollowRequestError) => {
            // Failed while retrieving follow request by id
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getFollowRequestError,
              'requestedUser'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * removeFollower - Removes a user's follower. The client will no longer have
 * that user as a follower. That user will no longer be following the client.
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the result
 */
var removeFollower = function(_request, _response, _callback) {
  const SOURCE = 'removeFollower()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      let invalidParams = [];
      if (!isValidUsername(_request.params.username)) invalidParams.push('username');
      if (!isValidUsername(_request.params.follower)) invalidParams.push('follower');

      if (invalidParams.length > 0) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          `Invalid parameters: ${invalidParams.join()}`
        );

        _callback(errorJson);
      } else if (_request.params.username !== client.username) {
        // Client is trying to remove follower on behalf of another user
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'You cannot remove another user\'s followers'
        );

        _callback(errorJson);
      } else {
        // Parameters are valid, so see if the client has that followerId
        FIREBASE.GET(
          `/users/${client.username}/followers/${_request.params.follower}`,
          (followerUsername) => {
            if (followerUsername === null) {
              // That follower does not exist for the client
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That follower does not exist'
              );

              _callback(errorJson);
            } else {
              // Follower exists, so get the user info for that follower
              FIREBASE.GET(
                `/users/${followerUsername}`,
                (followerInfo) => {
                  // The user that the client is followed by no longer exists
                  if (followerInfo === null) {
                    log(`${client.username} tried to remove '${followerUsername}' from followers, but that user does not exist`);

                    /**
                     * Remove follower from client's followers even
                     * though the linked user doesn't exist anymore
                     */
                    FIREBASE.DELETE(
                      `/users/${client.username}/followers/${followerUsername}`,
                      () => {
                        let successJson = {
                          success: {
                            message: 'Successfully removed follower',
                          }
                        };

                        _callback(successJson);
                      },
                      (removeFollowerError) => {
                        let errorJson = ERROR.determineFirebaseError(
                          SOURCE,
                          _request,
                          _response,
                          removeFollowerError
                        );

                        _callback(errorJson);
                      }
                    );
                  } else {
                    removeConnection(
                      client.username,
                      'followers',
                      followerUsername,
                      'follows',
                      () => {
                        let successJson = {
                          success: {
                            message: 'Successfully removed follower',
                          }
                        };

                        _callback(successJson);
                      },
                      (removeConnectionError) => {
                        let errorJson = ERROR.determineFirebaseError(
                          SOURCE,
                          _request,
                          _response,
                          removeConnectionError
                        );

                        _callback(errorJson);
                      }
                    );
                  }
                },
                (getFollowerInfoError) => {
                  // Failed while getting the follower's user info
                  let errorJson = ERROR.determineFirebaseError(
                    SOURCE,
                    _request,
                    _response,
                    getFollowerInfoError
                  );

                  _callback(errorJson);
                }
              );
            }
          },
          (getFollowerError) => {
            // Failed while getting follower
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getFollowerError
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

/**
 * unfollow - Removes a user from a client's follows. The client will no
 * longer follow that user. That user will no longer be followed by the client
 * @param {Object} _request the HTTP request
 * @param {Object} _response the HTTP response
 * @param {callback} _callback the callback to return the result
 */
var unfollow = function(_request, _response, _callback) {
  const SOURCE = 'unfollow()';
  log(SOURCE, _request);

  // Verify client's web token first
  AUTH.verifyToken(
    _request,
    _response,
    (client) => {
      // Token is valid, so check request parameters
      let invalidParams = [];
      if (!isValidUsername(_request.params.username)) invalidParams.push('username');
      if (!isValidUsername(_request.params.followedUser)) invalidParams.push('followedUser');

      if (invalidParams.length > 0) {
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          `Invalid parameters: ${invalidParams.join()}`
        );

        _callback(errorJson);
      } else if (_request.params.username !== client.username) {
        // Client is trying to unfollow another user on behalf of someone else
        let errorJson = ERROR.error(
          SOURCE,
          _request,
          _response,
          ERROR.CODE.INVALID_REQUEST_ERROR,
          'You cannot remove another user\'s follows'
        );

        _callback(errorJson);
      } else {
        // Parameters are valid, so query database for the follow
        FIREBASE.GET(
          `/users/${client.username}/follows/${_request.params.followedUser}`,
          (followedUserName) => {
            if (followedUserName === null) {
              let errorJson = ERROR.error(
                SOURCE,
                _request,
                _response,
                ERROR.CODE.RESOURCE_DNE_ERROR,
                'That follow does not exist'
              );

              _callback(errorJson);
            } else {
              /**
               * The followed user exists in the client's follows.
               * See if that user exists in the user's table
               */
              FIREBASE.GET(
                `/users/${followedUserName}`,
                (followedUserInfo) => {
                  if (followedUserInfo === null) {
                    // The user that the client follows no longer exists
                    log(`User tried to unfollow '${followedUserName}', but that user does not exist`);

                    /**
                     * Try to remove follow for client even though
                     * the linked user doesn't exist anymore
                     */
                    FIREBASE.DELETE(
                      `/users/${client.username}/follow/${followedUserName}`,
                      () => {
                        let successJson = {
                          success: {
                            message: 'Successfully unfollowed that user',
                          }
                        };

                        _callback(successJson);
                      },
                      (removeFollowError) => {
                        let errorJson = ERROR.determineFirebaseError(
                          SOURCE,
                          _request,
                          _response,
                          removeFollowError
                        );

                        _callback(errorJson);
                      }
                    );
                  } else {
                    removeConnection(
                      client.username,
                      'follows',
                      followedUserName,
                      'followers',
                      () => {
                        let successJson = {
                          success: {
                            message: 'Successfully unfollowed that user',
                          }
                        };

                        _callback(successJson);
                      },
                      (removeConnectionError) => {
                        let errorJson = ERROR.determineFirebaseError(
                          SOURCE,
                          _request,
                          _response,
                          removeConnectionError
                        );

                        _callback(errorJson);
                      }
                    );
                  }
                },
                (getFollowedUserInfoError) => {
                  // Failed while getting the followed user info
                  let errorJson = ERROR.determineFirebaseError(
                    SOURCE,
                    _request,
                    _response,
                    getFollowedUserInfoError
                  );

                  _callback(errorJson);
                }
              );
            }
          },
          (getFollowedUserError) => {
            // Failed while getting the followed user
            let errorJson = ERROR.determineFirebaseError(
              SOURCE,
              _request,
              _response,
              getFollowedUserError,
              'followedUser'
            );

            _callback(errorJson);
          }
        );
      }
    },
    (passportError, tokenError, userInfoMissing) => {
      let errorJson = ERROR.determineAuthenticationError(
        SOURCE,
        _request,
        _response,
        passportError,
        tokenError,
        userInfoMissing
      );

      _callback(errorJson);
    }
  );
};

module.exports = {
  authenticate: authenticate,
  createUser: createUser,
  getUser: getUser,
  updateUserEmail: updateUserEmail,
  updateUserPassword: updateUserPassword,
  deleteUser: deleteUser,
  createDropp: createDropp,
  addImage: addImage,
  getDropp: getDropp,
  getImage: getImage,
  getAllDropps: getAllDropps,
  getDroppsByLocation: getDroppsByLocation,
  getDroppsByUser: getDroppsByUser,
  getDroppsByFollows: getDroppsByFollows,
  updateDroppText: updateDroppText,
  deleteDropp: deleteDropp,
  requestToFollow: requestToFollow,
  getFollowers: getFollowers,
  getFollows: getFollows,
  getFollowerRequests: getFollowerRequests,
  getFollowRequests: getFollowRequests,
  respondToFollowerRequest: respondToFollowerRequest,
  removeFollowRequest: removeFollowRequest,
  removeFollower: removeFollower,
  unfollow: unfollow,
};

/** Other functions */

/**
 * getConnections - Retrieves a user's connections (followers or follows)
 * @param {String} _username the requested username
 * @param {String} _connectionsType the type of connection (followers or follows)
 * @param {callback} _callback the callback to return the result
 * @param {callback} _errorCallback the callback to return any errors
 * @throws an error if _connectionsType is not 'followers' or 'follows'
 */
function getConnections(_username, _connectionsType, _callback, _errorCallback) {
  const SOURCE = 'getConnections()';
  log(SOURCE);

  if (_connectionsType !== 'followers' && _connectionsType !== 'follows') {
    throw `connectionsType must be 'followers' or 'follows', not '${_connectionsType}'`;
  } else {
    // Retrieve connections
    FIREBASE.GET(
      `/users/${_username}/${_connectionsType}`,
      connections => _callback(connections === null ? {} : connections),
      getConnectionsError => _errorCallback(getConnectionsError)
    );
  }
}

/**
 * getRequests - Retrieves a user's requests (follower or follows)
 * @param {String} _requestsType the type of request (follower or follows)
 * @param {String} _client the requesting client's username
 * @param {callback} _callback the callback to return the result
 * @param {callback} _errorCallback the callback to return any errors
 * @throws an error if _requestsType is not 'follower' or 'follows'
 */
function getRequests(_requestsType, _client, _callback, _errorCallback) {
  const SOURCE = 'getRequests()';
  log(SOURCE);

  if (_requestsType !== 'follower' && _requestsType !== 'follow') {
    throw `requestsType must be 'follower' or 'follow', not '${_requestsType}'`;
  } else {
    // Retrieve requests
    FIREBASE.GET(
      `/users/${_client}/${_requestsType}_requests`,
      requests => _callback(requests === null ? {} : requests),
      getRequestsError => _errorCallback(getRequestsError)
    );
  }
}

/**
 * addConnection - Connects two users, allowing one to follow
 * the other. The requester will have the recipient in their
 * follows. The recipient will have the requester in the followers
 * @param {String} _recipient the recipient who accepted the follower request
 * @param {String} _requester the user who sent the follow request
 * @param {callback} _callback the callback to return the result
 * @param {callback} _errorCallback the callback to return any errors
 */
function addConnection(_recipient, _requester, _callback, _errorCallback) {
  const SOURCE = 'addConnection()';
  log(SOURCE);

  // Add the requester to the recipient's followers
  FIREBASE.UPDATE(
    `/users/${_recipient}/followers/${_requester}`,
    _requester,
    (newFollower) => {
      // Now add the recipient to the requester's follows
      FIREBASE.UPDATE(
        `/users/${_requester}/follows/${_recipient}`,
        _recipient,
        newFollow => _callback(),
        (addFollowError) => {
          /**
           * Failed while trying to add the recipient to the requester's follows.
           * Remove the requester from the recipient's followers to maintain consistency
           */
          FIREBASE.DELETE(
            `/users/${_recipient}/followers/${_requester}`,
            () => _errorCallback(addFollowError),
            (deleteFollowerError) => {
              // Failed while removing follower from recipient's followers
              log(`${SOURCE}: Failed removing '${_requester}' from '${_recipient}'s followers`);
              _errorCallback(deleteFollowerError);
            }
          );
        }
      );
    },
    addFollowerError => _errorCallback(addFollowerError)
  );
}

/**
 * removeRequest - Removes a pending request from one user to another.
 * This could be a follower request or a follow request. Regardless
 * of the type, the request will be removed from both user's requests
 * @param {String} _userA the user who is initiating the removal
 * @param {String} _requestTypeA the type of request that _userA is removing
 * @param {String} _userB the other user associated with the request
 * @param {String} _requestTypeB the opposite of _requestTypeA
 * @param {callback} _callback the callback to return the result
 * @param {callback} _errorCallback the callback to return any errors
 */
function removeRequest(_userA, _requestTypeA, _userB, _requestTypeB, _callback, _errorCallback) {
  const SOURCE = 'removeRequest()';
  log(SOURCE);

  // Remove request from user A
  FIREBASE.DELETE(
    `/users/${_userA}/${_requestTypeA}_requests/${_userB}`,
    () => {
      FIREBASE.DELETE(
        `/users/${_userB}/${_requestTypeB}_requests/${_userA}`,
        () => _callback(),
        removeUserBRequestError => _errorCallback(removeUserBRequestError)
      );
    },
    removeUserARequestError => _errorCallback(removeUserARequestError)
  );
}

/**
 * removeConnection - Removes a connection from one user to another.
 * This could be a follower or a follow. Regardless of the type,
 * the connection will be removed from both user's connections
 * @param {String} _userA the user who is initiating the removal
 * @param {String} _connectionTypeA the type of connection that _userA is removing
 * @param {String} _userB the other user associated with the connection
 * @param {String} _connectionTypeB the opposite of _connectionTypeA
 * @param {callback} _callback the callback to return the result
 * @param {callback} _errorCallback the callback to return any errors
 */
function removeConnection(
  _userA,
  _connectionTypeA,
  _userB,
  _connectionTypeB,
  _callback,
  _errorCallback
) {
  const SOURCE = 'removeConnection()';
  log(SOURCE);

  // Remove connection from user A
  FIREBASE.DELETE(
    `/users/${_userA}/${_connectionTypeA}/${_userB}`,
    () => {
      FIREBASE.DELETE(
        `/users/${_userB}/${_connectionTypeB}/${_userA}`,
        () => _callback(),
        (removeUserBConnectionError) => {
          // Failed while removing user B's connection for user A
          log(`${SOURCE}: Failed removing '${_userA}' from '${_userB}'s ${_connectionTypeB.toUpperCase()}`);
          _errorCallback(removeUserBConnectionError);
        }
      );
    },
    removeUserAConnectionError => _errorCallback(removeUserAConnectionError)
  );
}

/** Helper functions */

/**
 * removeUser - Deletes a user from the user's table
 * @param {String} _username the username of the desired user
 * @param {callback} _callback the callback to return the result
 * @param {callback} _errorCallback the callback to return any errors
 */
function removeUser(_username, _callback, _errorCallback) {
  const SOURCE = 'removeUser()';
  log(SOURCE);

  FIREBASE.DELETE(
    `/users/${_username}`,
    () => _callback(),
    deleteUserError => _errorCallback(deleteUserError)
  );
}

/**
 * encodeForReactNative - Encodes a buffer of data into base-64 string format
 * @param {Object} _buffer Buffer object containing the data to be encoded
 * @param {_callback} _callback the callback to return the encoded string
 */
function encodeForReactNative(_buffer, _callback) {
  const SOURCE = 'encodeForReactNative()';
  log(SOURCE);

  // Encode buffer data to base-64 string
  let base64String = _buffer.toString('base64');

  // First chunk of buffer data will have the encoding type
  let encodedFiletype = base64String.substring(0,14);

  var filetype;
  if (encodedFiletype === '/9j/4AAQSkZJRg') filetype = 'jpeg';
  else if (encodedFiletype === 'iVBORw0KGgoAAA') filetype = 'png';
  else {
    filetype = 'unknown';
    log(`${SOURCE}: Unable to determine filetype (${encodedFiletype})`);
  }

  // Return a string with the image type and encoded image data that can be put in an <img> HTML tag
  _callback(`data:image/${filetype};base64,${base64String}`);
}

/**
 * distance - Haversine function to calculate the distance between two GPS coordinates
 * @param {Number[]} loc1 an array of latitude,longitude coordinates
 * @param {Number[]} loc2 an array of latitude,longitude coordinates
 * @returns {Number} the straight-line distance between loc1 and loc2
 */
function distance(loc1, loc2) {
  let toRadians = degrees => degrees * Math.PI / 180;

  let dLat = toRadians(loc2[0] - loc1[0]);
  let dLon = toRadians(loc2[1] - loc1[1]);
  let lat1 = toRadians(loc1[0])
  let lat2 = toRadians(loc2[0]);

  let a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.sin(dLon / 2) * Math.sin(dLon / 2)
    * Math.cos(lat1) * Math.cos(lat2);

  let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  // Multiply by the approx radius of the earth (meters)
  return c * 6371e3;
}

/**
 * getCloseDropps - Returns the dropps that are near a given location
 * @param {Object} _dropps JSON of dropps
 * @param {String} _targetLocation comma-separated
 * string representing lat,long coordinates
 * @param {Number} _maxDistance the radius extending from targetLocation
 * @param {callback} _callback the callback to return the result
 * @throws {String} _targetLocation must be a comma-separated
 * string with two floats. _maxDistance must be a positive float
 */
function getCloseDropps(_dropps, _targetLocation, _maxDistance, _callback) {
  const SOURCE = 'getCloseDropps()';
  log(SOURCE);

  if (!isValidLocation(_targetLocation)) {
    throw `Invalid _targetLocation (${_targetLocation}). Must be a string like 'x,y', where x & y are floats`;
  } else if (!isValidPositiveFloat(_maxDistance)) {
    throw `Invalid _maxDistance (${_maxDistance}). Must be a positive floating-point number`;
  }

  let closeDropps = {};
  let closeDroppsCount = 0;
  let maxDistance = Number(_maxDistance);
  let targetLocation = _targetLocation.trim().split(',').map(Number);

  // Loop over all the dropps in the dropps JSON
  for (let droppKey in _dropps) {
    let dropp = _dropps[droppKey];

    // If the dropp doesn't have a valid location, don't bother calculating distance
    if (!isValidLocation(dropp.location)) continue;

    // Turn the string lat,long coordinates into a number array
    let droppLocation = dropp.location.split(',').map(Number);

    // Calculate straight-path distance between the points
    let distanceFromTarget = distance(targetLocation, droppLocation);
    if (distanceFromTarget <= maxDistance) {
      // The current dropp is within maxDistance so save it to closeDropps
      closeDropps[droppKey] = dropp;
      closeDroppsCount++;
    }
  }

  // Return JSON with count of close dropps and all the close dropps
  _callback({ count: closeDroppsCount, dropps: closeDropps });
}

/**
 * removeFile - Removes a file from the local filesystem
 * @param {String} _filePath the path to the desired file
 */
function removeFile(_filePath) {
  const SOURCE = 'removeFile()';
  log(`${SOURCE} ${_filePath}`);

  FS.unlink(_filePath, (unlinkError) => {
    if (unlinkError) log(`${SOURCE}: Failed to remove temp file at ${_filePath}`);
    else log(`${SOURCE}: Removed temp file at ${_filePath}`);
  });
}

/** Validator functions */

/**
 * isValidUsername - Validates a username
 * @param {String} _username a username
 * @returns {Boolean} validity of _username
 */
function isValidUsername(_username) {
  /**
   * Evaluates to true if _username is not null, not undefined, not
   * empty, and only contains alphanumeric characters, dashes, or
   * underscores. It must start with two alphanumeric characters
   */
  return _username !== null &&
    _username !== undefined &&
    (/^[a-zA-Z0-9]{2,}[\w\-]*$/).test(_username);
}

/**
 * isValidEmail - Validates an email address
 * @param {String} _email an email
 * @returns {Boolean} validity of _email
 */
function isValidEmail(_email) {
  // Evaluates to true if true if _email is not null, not undefined, and matches valid email formats
  return _email !== null &&
    _email !== undefined &&
    (/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/).test(_email);
}

/**
 * isValidPassword - Validates a password
 * @param {String} _password a password
 * @returns {Boolean} validity of _password
 */
function isValidPassword(_password) {
  /**
   * Evaluates to true if _password is not null, not undefined, not
   * empty, and only contains alphanumeric and special characters
   */
  return _password !== null && _password !== undefined && (/^[\w\S]+$/).test(_password);
}

/**
 * isValidId - Validates an id
 * @param {String} _id an id
 * @returns {Boolean} validity of _id
 */
function isValidId(_id) {
  /**
   * Evaluates to true if _id is not null, not undefined, not empty,
   * and only contains alphanumeric characters, underscores, and dashes
   */
  return _id !== null && _id !== undefined && (/^[\w\-]+$/).test(_id);
}

/**
 * isValidLocation - Validates a location
 * @param {String} _location the location string of the form 'latitude,longitude'
 * @returns {Boolean} validity of _location
 */
function isValidLocation(_location) {
  /**
   * Evaluates to true if _location is not null, not undefined,
   * not empty, and is two comma separated decimal numbers
   */
  return _location !== null &&
    _location !== undefined &&
    typeof _location === 'string' &&
    (/^(\-?\d+(\.\d+)?),\s*(\-?\d+(\.\d+)?)$/).test(_location);
}

/**
 * isValidMedia - Validates a media text string
 * @param {String} _media the media string
 * @returns {Boolean} validity of _media
 */
function isValidMedia(_media) {
  // Evalutes to true if media is not null, not undefined, and a string equal to 'true' or 'false'
  return _media !== null && _media !== undefined && (_media === 'true' || _media === 'false');
}

/**
 * isValidInteger - Validates an integer
 * @param {Number} _number a number
 * @returns {Boolean} validity of _number
 */
function isValidInteger(_number) {
  // Evalutes to true if _number is not null, not undefined, not empty, and only numeric
  return _number !== null && _number !== undefined && (/^\d+$/).test(_number);
}

/**
 * isValidPositiveFloat - Validates a positive floating-point number
 * @param {Number} _number a number
 * @returns {Boolean} validity of _number
 */
function isValidPositiveFloat(_number) {
  // Evalutes to true if _number is not null, not undefined, and a non-negative float
  return _number !== null && _number !== undefined && (/^\d+(\.\d*)?$/).test(_number);
}

/**
 * isValidTextPost - Validates a text post
 * @param {String} _text a text post
 * @returns {Boolean} validity of _text
 */
function isValidTextPost(_text) {
  // Evaluates to true if _text is not null, not undefined, and not empty
  return _text !== null && _text !== undefined && _text.toString().trim().length !== 0;
}

/**
 * log - Logs a message to the server console
 * @param {String} _message the log message
 * @param {Object} _request the HTTP request
 */
function log(_message, _request) {
  LOG.log('Middleware Module', _message, _request);
}
