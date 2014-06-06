// Date Foursquare API integration was last verified
var foursquareApiVersion = '20131009';

if (Meteor.isClient) {
  Template.hello.greeting = function () {
    var greeting = "Welcome to likelist";
    if (Meteor.user()){
      greeting += ", " + Meteor.user().profile.firstName;
    }
    return greeting;
  };

  Template.likelist.events = {
    'click #create': function() {
      Meteor.call('createList');
    },
    'click #populate': function() {
      Meteor.call('populateInitialList');
    }
  }

  Deps.autorun(function() {
    Meteor.subscribe("userData");
  });
}

if (Meteor.isServer) {

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

          console.log('Created new likelist ' + result.data.response.list.id + ' for user ' + Meteor.userId());
        } catch (e) {
          throw new Meteor.Error(500, 'Error creating new user. Could not create a new list on Foursquare to hold likes. Please try again.');
        }
      }
    },
    populateInitialList: function() {

      var user = Meteor.user();

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
        var existingLikelistItems = listResult.data.response.list.listItems.items;
      } catch (e) {
        throw "Error retrieving likelist from Foursquare";
      }

      // Retrive complete history from Foursquare API and check all venues
      HTTP.call(
        "GET",
        "https://api.foursquare.com/v2/users/self/venuehistory",
        {params: {
                oauth_token: user.services.foursquare.accessToken,
                v: foursquareApiVersion,
                afterTimestamp: 1401580800 // 06/01/2014 // TODO: Change back to 0
        }},
        function(error, result){
          if (result.statusCode === 200){
            console.log('Checking ' + result.data.response.venues.count + ' venues for user ' + user._id)
            for (var i = result.data.response.venues.items.length - 1; i >= 0; i--) {
              checkVenue(result.data.response.venues.items[i].venue, existingLikelistItems);
            }

            // TODO: Schedule retrieval, so user doesn't have to login
          }
          else console.log(error);
        }
      );
    }
  });

  function checkVenue(venue, existingLikelistItems) {
    var user = Meteor.user();

    // Allow 500 user requests per hour (the Foursquare API limit, see https://developer.foursquare.com/overview/ratelimits)
    var userLimiter = new RateLimiter(500, 'hour'); // TODO: Persist this limiter

    // Throttle requests
    appLimiter.removeTokens(1, Meteor.bindEnvironment(function(venue){ return function(err, remainingRequests) {
      var likesResult = HTTP.call(
        "GET",
        "https://api.foursquare.com/v2/venues/" + venue.id + "/likes",
        {params: {
          oauth_token: user.services.foursquare.accessToken,
          v: foursquareApiVersion}
        }
      );
      if (likesResult.statusCode === 200){
        var likedVenueExists = existingLikelistItems.map(function(listItem){return listItem.venue.id}).indexOf(venue.id) !== -1;
        if (likesResult.data.response.like && !likedVenueExists){
          userLimiter.removeTokens(1, function(err, remainingRequests) {
            try {
              var addResult = HTTP.call(
                "POST",
                "https://api.foursquare.com/v2/lists/" + user.likelist.id + "/additem",
                {params: {
                  oauth_token: user.services.foursquare.accessToken,
                  v: foursquareApiVersion,
                  venueId: venue.id
                }}
              );
              if (addResult.statusCode === 200) console.log('Added new liked venue ' + venue.id + ' for user ' + user._id);
            } catch (e) {
              throw "Error adding new liked venue to list"
            }
          });
        }
        else if (!likesResult.data.response.like && likedVenueExists) {
          userLimiter.removeTokens(1, function(err, remainingRequests) {
            try {
              var removeResult = HTTP.call(
                "POST",
                "https://api.foursquare.com/v2/lists/" + user.likelist.id + "/deleteitem",
                {params: {
                  oauth_token: user.services.foursquare.accessToken,
                  v: foursquareApiVersion,
                  venueId: venue.id
                }}
              );
              if (removeResult.statusCode === 200) console.log('Removed no longer liked venue ' + venue.id + ' for user ' + user._id);
            } catch (e) {
              throw "Error removing no longer liked venue from list"
            }
          });
        }
      }
    }}(venue)));
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
  });
}
