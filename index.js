'use strict';
var AlexaSkill = require('./AlexaSkill');
var AWS = require("aws-sdk");
var APP_ID = undefined;
AWS.config.update({
 region: "us-east-1",
 endpoint: "https://dynamodb.us-east-1.amazonaws.com",
 accessKeyId: "",//hidden for security purposes
 secretAccessKey: ""//hidden for security purposes
});
var docClient = new AWS.DynamoDB.DocumentClient();

/**
 * FreshBox is a child of AlexaSkill.
 * To read more about inheritance in JavaScript, see the link below.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Introduction_to_Object-Oriented_JavaScript#Inheritance
 */
var FreshBox = function () {
    AlexaSkill.call(this, APP_ID);
    this.usernumber = 0;
    this.username = "";
};
function SessionInitializer(session, callback,alert_string) {
  console.log("starting launch application");
  var table = "pantry_users";
  var params = {
  TableName: table,
    Key:{
        "user_id": session.user.userId
    }
  };
  console.log("fetching data from the table.");
  docClient.get(params, function(err, data) {
    if (err) {
      console.error("Unable to read item. Error JSON:", JSON.stringify(err, null, 2));
    } else {
      var user_data =  JSON.stringify(data, null, 2);
      var jsonData = JSON.parse(user_data);
      if(jsonData.Item) {
        session.attributes.userFoods = [];
        if(jsonData.Item.pantry_foods) {//user has foods , store in session attributes
          session.attributes.userFoods = jsonData.Item.pantry_foods;
        }
        if(alert_string) {
          callback(session,alert_string);
        } else {
          callback();
        }
      } else {//if user not found create a new entry
        //need to insert user into database and update pk, then run as usual
        var params = {
            TableName:table,
            Item:{
                "user_id": session.user.userId
            }
        };
        console.log("Adding a new item...");
        docClient.put(params, function(err, data) {
            if (err) {
                console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
            } else {
                console.log("Added item:", JSON.stringify(data, null, 2));
                session.attributes.userFoods = [];
                if(alert_string) {
                  callback(session,alert_string);
                } else {
                  callback();
                }
            }
        });
      }
    }
  });
}
var updateItems = function(session) {
  var table = "pantry_users";
  var params = {
    TableName:table,
    Key:{
        "user_id": session.user.userId
    },
    UpdateExpression: "set pantry_foods = :cur_items",
    ExpressionAttributeValues:{
        ":cur_items":session.attributes.userFoods
    },
    ReturnValues:"UPDATED_NEW"
  };
  console.log("Updating the item...");
  docClient.update(params, function(err, data) {
      if (err) {
          console.error("Unable to update item. Error JSON:", JSON.stringify(err, null, 2));
      } else {
          console.log("UpdateItem succeeded:", JSON.stringify(data, null, 2));
      }
  });
};
function ModifyResponse (itemData, itemName, response, session, callback) {
      var cardTitle = itemName,
          speechOutput,
          repromptOutput;
      if (itemData) {
          speechOutput = {
              speech: itemData,
              type: AlexaSkill.speechOutputType.PLAIN_TEXT
          };
          response.tellWithCard(speechOutput, cardTitle, "recipe");
          if(callback) {
            callback(session);
          }
      } else {
          var speech;
          if (itemName) {
              speech = "you need to pick up some " +  itemName + ". What else can I help with?";
          } else {
              speech = "I'm sorry, I currently do not know that item. What else can I help with?";
          }
          speechOutput = {
              speech: speech,
              type: AlexaSkill.speechOutputType.PLAIN_TEXT
          };
          repromptOutput = {
              speech: "What else can I help with?",
              type: AlexaSkill.speechOutputType.PLAIN_TEXT
          };
          response.ask(speechOutput, repromptOutput);
      }
}
function check_for_session(session,res_func) {
  var alert_string;
  if(!session.attributes.userFoods) {
    alert_string = "Let me find your information. ";
    SessionInitializer(session, res_func,alert_string);
  } else {
    alert_string = "";
    res_func(session, alert_string);
  }
}
// Extend AlexaSkill
FreshBox.prototype = Object.create(AlexaSkill.prototype);
FreshBox.prototype.constructor = FreshBox;
FreshBox.prototype.eventHandlers.onLaunch = function (launchRequest, session, response) {
  var launch_res = function() {
    var speechText = "Welcome to your pantry";
    console.log(speechText);
    var repromptText = "For instructions on what you can say, please say help me.";
    response.ask(speechText, repromptText);
  };
  if(!session.attributes.userFoods) {
    SessionInitializer(session,launch_res);
  } else {
    launch_res();
  }
};
FreshBox.prototype.eventHandlers.onSessionStarted = function (sessionStartedRequest, session) {//load all user data from database
    console.log("a new session has started");
    //SessionInitializer(session);
};

FreshBox.prototype.intentHandlers = {
    "QuantityIntent": function (intent, session, response) {
      var itemSlot = intent.slots.Item,
          itemName;
      var modifierSlot = intent.slots.Modifier,
          modifier;
      if (itemSlot && itemSlot.value){
          itemName = itemSlot.value.toLowerCase();
      }
      if(modifierSlot && modifierSlot.value) {
        modifier = modifierSlot.value.toLowerCase();
      }
      var findItem = function(session,alert_string) {
        var itemData = null;
        var plural_name = itemName + 's';
        for(var i = 0; i < session.attributes.userFoods.length; i++) {
          var nxt_item = session.attributes.userFoods[i];
          if (nxt_item.name === itemName || nxt_item.name === plural_name) {
            itemData = alert_string + "you currently have ";
            itemData += nxt_item.quantity
            itemData += nxt_item.modifier ? (" " + nxt_item.modifier + " of ") : " ";//if modifier, append appropriately
            itemData += nxt_item.name;
            if(nxt_item.quantity > 1 && !nxt_item.modifier) {
              itemData += "s";
            }
            break;
          }
        }
        ModifyResponse(itemData, itemName, response);
      };
      check_for_session(session,findItem);
  },
  "AllFoodsIntent": function (intent, session, response) {
    var findAllItems = function(session,alert_string) {
      var itemData = alert_string + "You have ";
      var num_foods = session.attributes.userFoods.length;
      if(num_foods === 0) {
        itemData += " no food";
      }
      for(var index = 0; index < num_foods; index++) {
        var nxt_item = session.attributes.userFoods[index];
        if(index === num_foods - 1 && num_foods > 1) {
          itemData += " and ";
        }
        itemData += nxt_item.quantity
        itemData += nxt_item.modifier ? (" " + nxt_item.modifier + " of ") : " ";//if modifier, append appropriately
        itemData += nxt_item.name;
        if(nxt_item.quantity > 1 && !nxt_item.modifier) {
          itemData += "s";
        }
        if(index < num_foods - 1 && num_foods > 1) {
          itemData += ",";
        }
      }
      itemData += " in your pantry.";
      ModifyResponse(itemData, null, response);
    };
    check_for_session(session,findAllItems);
},
  "RemoveIntent": function (intent, session, response) {
      var itemSlot = intent.slots.Item,
          itemName;
      var numberSlot = intent.slots.Number,
          number;
      var modifierSlot = intent.slots.Modifier,
          modifier;
      if (itemSlot && itemSlot.value){
        itemName = itemSlot.value.toLowerCase();
      }
      if(numberSlot && numberSlot.value) {
        number = numberSlot.value;
      }
      if(modifierSlot && modifierSlot.value) {
        modifier = modifierSlot.value.toLowerCase();
      }
      var removeItem = function(session,alert_string) {
        var itemData = null;
        for(var i = 0; i < session.attributes.userFoods.length; i++) {
          var plural_name = itemName + 's';
          var nxt_item = session.attributes.userFoods[i];
          if ((nxt_item.name === itemName || nxt_item.name === plural_name) && number) {
            if(nxt_item.quantity >=  Number(number)) {
              nxt_item.quantity -= Number(number);
              itemData = alert_string + " you now have ";
              itemData +=  nxt_item.quantity;
              itemData += nxt_item.modifier ? (" " + nxt_item.modifier + " of ") : " ";//if modifier, append appropriately
              itemData += nxt_item.name;
              if(nxt_item.quantity > 1 && !nxt_item.modifier) {
                itemData += "s";
              }
              console.log('you have ' + nxt_item.quantity + ' and are trying to remove' + number);
            } else {
              console.log('you have ' + nxt_item.quantity + ' and are trying to remove' + number);
              itemData = alert_string + " you do not have enough " + itemName;
              if(nxt_item.quantity > 1 && !nxt_item.modifier) {
                itemData += "s";
              }
            }
            break;
          }
        }
        ModifyResponse(itemData, itemName, response, session,updateItems);
      };
      check_for_session(session,removeItem);
    },
    "AddIntent": function (intent, session, response) {
        var itemSlot = intent.slots.Item,
            itemName;
        var numberSlot = intent.slots.Number,
            number;
        var modifierSlot = intent.slots.Modifier,
            modifier;
        if (itemSlot && itemSlot.value){
          itemName = itemSlot.value.toLowerCase();
        }
        if(numberSlot && numberSlot.value) {
          number = numberSlot.value;
        }
        if(modifierSlot && modifierSlot.value) {
          modifier = modifierSlot.value.toLowerCase();
        }
        var addItem = function(session,alert_string) {
          var itemData = null;
          for(var i = 0; i < session.attributes.userFoods.length; i++) {
            var nxt_item = session.attributes.userFoods[i];
            if (nxt_item.name === itemName && number) {
              nxt_item.quantity = Number(nxt_item.quantity) + Number(number);
              itemData = alert_string + " you now have ";
              itemData +=  nxt_item.quantity;
              itemData += nxt_item.modifier ? (" " + nxt_item.modifier + " of ") : " ";//if modifier, append appropriately
              itemData += nxt_item.name;
              if(nxt_item.quantity > 1 && !nxt_item.modifier) {
                itemData += "s";
              }
              break;
            }
          }
          if(!itemData && itemName && number) {//user didn't have any of the item, append to sessionAttributes
            itemData = "Creating an entry in your pantry. You now have ";
            itemData +=  number;
            itemData += modifier ? (" " + modifier + " of ") : " ";//if modifier, append appropriately
            itemData += itemName;
            if(Number(number) > 1 && !modifier) {
              itemData += "s";
            }
            var new_item = {name:itemName, quantity:number};
            if(modifier) {
              new_item.modifier = modifier;
            }
            session.attributes.userFoods.push(new_item);
          }

          ModifyResponse(itemData, itemName, response, session,updateItems);
        };
        check_for_session(session,addItem);
    },
    "AMAZON.StopIntent": function (intent, session, response) {
        var speechOutput = "Goodbye";
        response.tell(speechOutput);
    },

    "AMAZON.CancelIntent": function (intent, session, response) {
        var speechOutput = "Goodbye";
        response.tell(speechOutput);
    },

    "AMAZON.HelpIntent": function (intent, session, response) {
        var speechText = "You can ask questions about the quantity of your items stored in your pantry, or add items to your kitchen, or, you can say exit... Now, what can I help you with?";
        var repromptText = "You can say things like, how many bananas do i have, or add three bananas, or you can say exit... Now, what can I help you with?";
        var speechOutput = {
            speech: speechText,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };
        var repromptOutput = {
            speech: repromptText,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };
        response.ask(speechOutput, repromptOutput);
    }
};

exports.handler = function (event, context) {
    var freshbox = new FreshBox();
    freshbox.execute(event, context);
};
