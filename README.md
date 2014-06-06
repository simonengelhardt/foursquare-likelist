likelist
===========

[likelist](http://likelist.meteor.com/) is a simple foursquare app, built on [Meteor](https://www.meteor.com/), that will maintain a list of all your liked venues on Foursquare.

Since Foursquare unfortunately does not provide API (or any) access to a list of likes, this app can only work by a bit of probing:

The first time a user authorizes the app, a list for holding liked venues will be created on Foursquare and the user's complete venue history will be checked for likes (within the rate limits of the Foursquare API).

Subsequently, whenever the user checks in somewhere, 3 checks for likes will be scheduled at 1, 3 and 24 hours after the check-in. Hopefully, this way new likes (or no-longer-likes) will be reflected in the list. Not the perfect solution, but a decent compromise given the limits of Foursquare's API.

Deployment-specific configuration
----------
likelist needs an object with at least the following content to be available in [Meteor.settings](http://docs.meteor.com/#meteor_settings):

    {
      "foursquare": {
        "pushSecret": "Foursquare App Push secret"
      }
    }
