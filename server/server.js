// Date Foursquare API integration was last verified
var foursquareApiVersion = '20131009';

Meteor.publish("userData", function () {
  return Meteor.users.find({_id: this.userId},
    {fields: {'likelist': 1}});
});

var RateLimiter = Meteor.require('limiter').RateLimiter;

// Allow 5000 userless (they aren't really, but the /venues endpoint counts them as such) requests per hour (the Foursquare API limit, see https://developer.foursquare.com/overview/ratelimits)
var appLimiter = new RateLimiter(5000, 'hour');

Meteor.methods({
  createList: function() {
    var user = Meteor.user();
    if (user.likelist === null) {
      console.log('creating list');
      try {
        var result = HTTP.call(
          "POST",
          "https://api.foursquare.com/v2/lists/add",
          {
            params: {
              oauth_token: user.services.foursquare.accessToken,
              v: foursquareApiVersion,
              name: user.profile.firstName + "'s Likes",
              description: 'All ' + user.profile.firstName + "'s likes. Automatically maintained by http://likelist.meteor.com/",
              collaborative: false
        }});

        // Save like list id and url on user object
        Meteor.users.update(Meteor.userId(), {$set: {likelist: {
          id: result.data.response.list.id,
          canonicalUrl: result.data.response.list.canonicalUrl
        }}});

        // Update local user variable so newly created list id is in there for the following logic
        user = Meteor.user();

        console.log('Created new likelist ' + result.data.response.list.id + ' for user ' + Meteor.userId());
      } catch (e) {
        throw new Meteor.Error(500, 'Error creating new user. Could not create a new list on Foursquare to hold likes. Please try again.');
      }

      // Retrive complete history from Foursquare API and check all venues
      HTTP.call(
        "GET",
        "https://api.foursquare.com/v2/users/self/venuehistory",
        {params: {
                oauth_token: user.services.foursquare.accessToken,
                v: foursquareApiVersion,
                afterTimestamp: 0 //1401580800 // = 06/01/2014 (for debugging)
        }},
        function(error, result){
          if (result.statusCode === 200){
            console.log('Checking ' + result.data.response.venues.count + ' venues for user ' + user._id)

            var existingLikelistItems = [];
            for (var i = result.data.response.venues.items.length - 1; i >= 0; i--) {
              checkVenue(user, result.data.response.venues.items[i].venue.id, existingLikelistItems);
            }
          }
          else console.log(error);
        }
      );

      return "You likelist has been created. It is now being filled with likes from your history. This may take a while.";
    }
  },
  processQueuedVenue: function(userId, venueId) {
    console.log('Processing queued venue ' + venueId + ' for user ' + userId);
    var user = Meteor.users.findOne({_id: userId});
    var existingLikelistItems = getCurrentLikelist(user);
    checkVenue(user, venueId, existingLikelistItems);
  }
});

function getCurrentLikelist(user) {
  // Get current likelist
  try {
    var listResult = HTTP.call(
      "GET",
      "https://api.foursquare.com/v2/lists/" + user.likelist.id,
      {params: {
        oauth_token: user.services.foursquare.accessToken,
        v: foursquareApiVersion,
        limit: 200 // TODO: add support for larger lists through paging, see https://developer.foursquare.com/docs/lists/lists
      }}
    )
    return listResult.data.response.list.listItems.items;
  } catch (e) {
    throw "Error retrieving likelist from Foursquare";
  }
}

Accounts.onCreateUser(function(options, user) {
  console.log('Creating new user');

  user.likelist = null;

  // We still want the default hook's 'profile' behavior.
  if (options.profile)
    user.profile = options.profile;
  return user;
});

Meteor.startup(function () {
  Meteor.setInterval(function(){Queue.run()}, 60000); /* once a minute */
  Meteor.setInterval(function(){Queue.purgeOldLocks()}, 60000); /* once a minute */
  Meteor.setInterval(function(){Queue.purgeCompletedTasks()}, 86400000); /* once a day */
  Meteor.setInterval(function(){Queue.purgeLogs()}, 86400000); /* once a day */
});


function checkVenue(user, venueId, existingLikelistItems) {

  // Throttle requests
  appLimiter.removeTokens(1, Meteor.bindEnvironment(function(venueId){ return function(err, remainingRequests) {
    var likesResult = HTTP.call(
      "GET",
      "https://api.foursquare.com/v2/venues/" + venueId + "/likes",
      {params: {
        oauth_token: user.services.foursquare.accessToken,
        v: foursquareApiVersion}
      }
    );
    if (likesResult.statusCode === 200){
      var likedVenueExists = existingLikelistItems.map(function(listItem){return listItem.venue.id}).indexOf(venueId) !== -1;
      if (likesResult.data.response.like && !likedVenueExists){
        try {
          var addResult = HTTP.call(
            "POST",
            "https://api.foursquare.com/v2/lists/" + user.likelist.id + "/additem",
            {params: {
              oauth_token: user.services.foursquare.accessToken,
              v: foursquareApiVersion,
              venueId: venueId
            }}
          );
          if (addResult.statusCode === 200) console.log('Added new liked venue ' + venueId + ' for user ' + user._id);
        } catch (e) {
          throw "Error adding new liked venue to list"
        }
      }
      else if (!likesResult.data.response.like && likedVenueExists) {
        try {
          var removeResult = HTTP.call(
            "POST",
            "https://api.foursquare.com/v2/lists/" + user.likelist.id + "/deleteitem",
            {params: {
              oauth_token: user.services.foursquare.accessToken,
              v: foursquareApiVersion,
              venueId: venueId
            }}
          );
          if (removeResult.statusCode === 200) console.log('Removed no longer liked venue ' + venueId + ' for user ' + user._id);
        } catch (e) {
          throw "Error removing no longer liked venue from list"
        }
      }
    }
  }}(venueId)));
}

// API
Router.map(function () {
  this.route('api/handle_push', {
    where: 'server',
    action: function () {
      var secret = this.request.body.secret;

      if (secret != Meteor.settings.foursquare.pushSecret) {
        return [403, 'Invalid secret provided'];
      }

      var checkin = JSON.parse(this.request.body.checkin);
      if (checkin) {
        var user = Meteor.users.findOne({"services.foursquare.id": checkin.user.id });
        if (user && user.likelist !== null) {
          var venue = checkin.venue;
          if (venue) {
            // schedule like checks
            var command = 'Meteor.call("processQueuedVenue", "' + user._id + '", "' + venue.id + '")';
            var now = moment();
            Queue.add({command: command, execute_after: now.add('hours', 1).toDate()});
            Queue.add({command: command, execute_after: now.add('hours', 3).toDate()});
            Queue.add({command: command, execute_after: now.add('days', 1).toDate()});
            console.log('Scheduled checks for venue ' + venue.id + ' for user ' + user._id);
          }
        }
      }
    }
  });
});
