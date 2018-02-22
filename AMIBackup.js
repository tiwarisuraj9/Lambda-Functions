var AWS = require("aws-sdk");
var ec2 = new AWS.EC2();
 
var numBackupsToRetain = 0; // The Number Of AMI Backups You Wish To Retain For Each EC2 Instance.
var instancesToBackupTagName = "Backup"; // Tag Key Attached To Instances You Want AMI Backups Of. Tag Value Should Be Set To "Yes".
var imageBackupTagName = "ScheduledAMIBackup"; // Tag Key Attached To AMIs Created By This Process. This Process Will Set Tag Value To "True".
var imageBackupInstanceIdentifierTagName = "ScheduledAMIInstanceId"; // Tag Key Attached To AMIs Created By This Process. This Process Will Set Tag Value To The Instance ID.
var deleteSnaphots = true; // True if you want to delete snapshots during cleanup. False if you want to only delete AMI, and leave snapshots intact.
 
exports.handler = function(event, context) {
    var describeInstancesParams = {
        DryRun: false,
        Filters: [{
            Name: "tag:" + instancesToBackupTagName,
            Values: ["Yes"]
        }]
    };
    ec2.describeInstances(describeInstancesParams, function(err, data) {
        if (err) {
            console.log("Failure retrieving instances.");
            console.log(err, err.stack); 
        }
        else {
            for (var i = 0; i < data.Reservations.length; i++) {
                for (var j = 0; j < data.Reservations[i].Instances.length; j++) {
                    var instanceId = data.Reservations[i].Instances[j].InstanceId;
                    createImage(instanceId);
                }
            }
        }
    });
    cleanupOldBackups();
};
 
var createImage = function(instanceId) {
    console.log("Found Instance: " + instanceId);
    var createImageParams = {
        InstanceId: instanceId,
        Name: "AMI Scheduled Backup I(" + instanceId + ") T(" + new Date().getTime() + ")",
        Description: "AMI Scheduled Backup for Instance (" + instanceId + ")",
        NoReboot: true,
        DryRun: false
    };
    ec2.createImage(createImageParams, function(err, data) {
        if (err) {
            console.log("Failure creating image request for Instance: " + instanceId);
            console.log(err, err.stack);
        }
        else {
            var imageId = data.ImageId;
            console.log("Success creating image request for Instance: " + instanceId + ". Image: " + imageId);
            var createTagsParams = {
                Resources: [imageId],
                Tags: [{
                    Key: "Name",
                    Value: "AMI Backup I(" + instanceId + ")"
                },
                {
                    Key: imageBackupTagName,
                    Value: "True"
                },
                {
                    Key: imageBackupInstanceIdentifierTagName,
                    Value: instanceId
                }]
            };
            ec2.createTags(createTagsParams, function(err, data) {
                if (err) {
                    console.log("Failure tagging Image: " + imageId);
                    console.log(err, err.stack);
                }
                else {
                    console.log("Success tagging Image: " + imageId);
                }
            });
        }
    });
};
 
var cleanupOldBackups = function() {
    var describeImagesParams = {
        DryRun: false,
        Filters: [{
            Name: "tag:" + imageBackupTagName,
            Values: ["True"]
        }]
    };
    ec2.describeImages(describeImagesParams, function(err, data) {
        if (err) {
            console.log("Failure retrieving images for deletion.");
            console.log(err, err.stack); 
        }
        else {
            var images = data.Images;
            var instanceDictionary = {};
            var instances = [];
            for (var i = 0; i < images.length; i++) {
                var currentImage = images[i];
                for (var j = 0; j < currentImage.Tags.length; j++) {
                    var currentTag = currentImage.Tags[j];
                    if (currentTag.Key === imageBackupInstanceIdentifierTagName) {
                        var instanceId = currentTag.Value;
                        if (instanceDictionary[instanceId] === null || instanceDictionary[instanceId] === undefined) {
                            instanceDictionary[instanceId] = [];
                            instances.push(instanceId);
                        }
                        instanceDictionary[instanceId].push({
                            ImageId: currentImage.ImageId,
                            CreationDate: currentImage.CreationDate,
                            BlockDeviceMappings: currentImage.BlockDeviceMappings
                        });
                        break;
                    }
                }
            }
            for (var t = 0; t < instances.length; t++) {
                var imageInstanceId = instances[t];
                var instanceImages = instanceDictionary[imageInstanceId];
                if (instanceImages.length > numBackupsToRetain) {
                    instanceImages.sort(function (a, b) {
                       return new Date(b.CreationDate) - new Date(a.CreationDate); 
                    });
                    for (var k = numBackupsToRetain; k < instanceImages.length; k++) {
                        var imageId = instanceImages[k].ImageId;
                        var creationDate = instanceImages[k].CreationDate;
                        var blockDeviceMappings = instanceImages[k].BlockDeviceMappings;
                        deregisterImage(imageId, creationDate, blockDeviceMappings);
                    }   
                }
                else {
                    console.log("AMI Backup Cleanup not required for Instance: " + imageInstanceId + ". Not enough backups in window yet.");
                }
            }
        }
    });
};
 
var deregisterImage = function(imageId, creationDate, blockDeviceMappings) {
    console.log("Found Image: " + imageId + ". Creation Date: " + creationDate);
    var deregisterImageParams = {
        DryRun: false,
        ImageId: imageId
    };
    console.log("Deregistering Image: " + imageId + ". Creation Date: " + creationDate);
    ec2.deregisterImage(deregisterImageParams, function(err, data) {
       if (err) {
           console.log("Failure deregistering image.");
           console.log(err, err.stack);
       } 
       else {
           console.log("Success deregistering image.");
           if (deleteSnaphots) {
                for (var p = 0; p < blockDeviceMappings.length; p++) {
                   var snapshotId = blockDeviceMappings[p].Ebs.SnapshotId;
                   if (snapshotId) {
                       deleteSnapshot(snapshotId);
                   }
               }    
           }
       }
    });
};
 
var deleteSnapshot = function(snapshotId) {
    var deleteSnapshotParams = {
        DryRun: false,
        SnapshotId: snapshotId
    };
    ec2.deleteSnapshot(deleteSnapshotParams, function(err, data) {
        if (err) {
            console.log("Failure deleting snapshot. Snapshot: " + snapshotId + ".");
            console.log(err, err.stack);
        }
        else {
            console.log("Success deleting snapshot. Snapshot: " + snapshotId + ".");
        }
    })
};