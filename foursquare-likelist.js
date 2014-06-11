if (Meteor.isClient) {
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
