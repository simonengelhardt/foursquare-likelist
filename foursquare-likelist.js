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
      Meteor.call('createList', function(error, result) {
        if (error) alert(error);
        if (result) alert(result);
      });
    }
  }

  Deps.autorun(function() {
    Meteor.subscribe("userData");
  });
}

if (Meteor.isServer) {

}
