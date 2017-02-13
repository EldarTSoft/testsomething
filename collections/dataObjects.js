DataObjects = new Mongo.Collection("dataObjects");

DataObjects.initFolders = () => {
    const user = Meteor.user()
    if (user.profile.initializedFolders === false) {
        Meteor.subscribe('rootFolders', (err) => {
            _.each(dashboardFolders, function(subfolderNames, dashboardFolderName) {
                const parentFolder = DataObjects.findOne({ fileName: dashboardFolderName });
                const parentFolderId = parentFolder ? parentFolder._id : null
                if (!parentFolderId) {
                    throw new Error('Missing top level Folder when initializing subfolders')
                }

                // Insert in reverse order because of 'newest first' ordering
                _.chain(subfolderNames).reverse().each(subfolder => {
                    addSubfolder(subfolder, parentFolderId, user._id);
                });
            });
            Meteor.users.update(user._id, { $set: { 'profile.initializedFolders': true } });
        })
    }
}

function addSubfolder(subfolderName, parentId, userId) {
    if (_.isObject(subfolderName)) {
        return _.each(subfolderName, (subfolders, folderName) => {
            var id = addSubfolder(folderName, parentId, userId);
            _.chain(subfolders).reverse().each(folder => addSubfolder(folder, id, userId));
        });
    }
    var subfolderId = DataObjects.insert({
        type: 'folder',
        fileName: tap(subfolderName, null, 'de'),
        ownerId: userId,
        uploadedAt: new Date(),
        updatedAt: new Date(),
        parent: parentId
    });

    DataObjects.update({
        _id: parentId
    }, {
        $push: {
            children: subfolderId
        }
    });
    return subfolderId;
}

Schema = {};
Schema.DataObject = new SimpleSchema({

    type: {
        type: String,
        defaultValue: 'file',
        allowedValues: ['file', 'folder', 'text'],
        index: 1
    },
    fileName: {
        type: String,
        label: function () {
            return tap('fileName');
        }
    },
    parent: {
        type: String,
        label: function () {
            return tap('parentFolder');
        },
        optional: true
    },
    ownerId: {
        type: String,
        label: function () {
            return tap('owner');
        }
    },
    uploadedAt: {
        type: Date,
        label: function () {
            return tap('uploadedAt');
        }
    },
    updatedAt: {
        type: Date,
        label: function () {
            return tap('updatedAt');
        }
    },
    encrypted: {
        type: Boolean,
        defaultValue: false
    },
    url: {
        type: String,
        regEx: SimpleSchema.RegEx.Url,
        optional: true
    },
    text: {
        type: String,
        optional: true
    },
    sse: {
        type: Boolean,
        optional: true
    },
    progress: {
        type: Number,
        optional: true,
        decimal: true
    },
    children: {
        type: [String],
        optional: true
    },
    filesize: {
        type: Number,
        optional: true
    },
    isSharedWithUsers: {
        type: [String],
        optional: true
    },
    thumbnail: {
        type: String,
        optional: true
    },
});

if(Meteor.isClient){
    DataObjects.helpers({
        fileType: function () {
            return getFileTypeOfFile(this.fileName);
        },
        getParent: function () {
            var self = this;
            // check if a beneficiary is using the software
            var beneficiaryId = Session.get('beneficiaryId');
            if (!!beneficiaryId) {
                return Meteor.promise(
                    'getParentIdOfDataObjectForBeneficiary',
                    self._id,
                    beneficiaryId,
                    self.ownerId
                );
            } else {
                return {
                    then: function (callback) {
                        callback(self.parent);
                    }
                };
            }
        }
    });
}
DataObjects.before.insert(function (userId, doc) {
    doc.ownerId = userId;
    doc.uploadedAt = new Date();
    doc.updatedAt = doc.uploadedAt;
});
if (Meteor.isServer) {
    DataObjects.after.insert(function (userId, doc) {
        if (!_.contains(Object.keys(dashboardFolders), doc.parent)) {
            DataObjects.update({
                _id: doc.parent
            }, {
                $push: {
                    children: doc._id
                }
            });
        }
    });
    DataObjects.after.remove(function(userId, doc) {
        if(doc.type === 'file') {
            RegistrationProcesses.update({
                userId: userId
            }, {
                $inc: {uploadedData: -doc.filesize}
            });
        }
    });
}
// TODO add after delete hook

DataObjects.attachSchema(Schema.DataObject);

DataObjectUtils = {
    getLabelForDoc: function (doc) {
        if (doc.type === 'folder') {
            return tap('folderName');
        } else if (doc.type === 'text') {
            return tap('textTitle');
        } else {
            return tap('fileName');
        }

    }
};

DataObjectsEncryption = null;

if (Meteor.isClient) {
    // define fields to be encrypted
    var fields = ['fileName', 'text'];
    // init encruption on collection Posts
    DataObjectsEncryption = new CollectionEncryption(DataObjects, fields, {
        // gets called once a key is successfully generated
        onKeyGenerated: function (key, doc) {
            // find file to encrypt for the given documentId
            var fileToEncrypt = _.findWhere(FilesToEncrypt, {
                fileName: doc.fileName
            });
            if (!fileToEncrypt) {
                console.warn(
                    'no file was found for document with id ' +
                    doc._id);
                return;
            }
            var index = FilesToEncrypt.map(function (file) {
                return file.fileName;
            }).indexOf(doc.fileName);
            FilesToEncrypt[index]._id = doc._id;
            // check if doc is a file
            if (doc.type !== 'file') {
                return;
            }

            // TODO: add file-encryption packages
            // if (fileToEncrypt.file.size >= 20 * 1024 * 1024) {
            uploadFileWithDataObject(fileToEncrypt.file, doc, key);

            // } else {
            //     Encryptor.encryptFile(fileToEncrypt, function (file) {
            //         console.log(file);
            //         uploadFileWithDataObject(new File(file.fileData, file.fileName, {
            //             contentType: file.contentType
            //         }), doc);
            //     });
            // }
        },
        onFinishedDocEncryption: function (doc) {
            // check if the doc is a profile picture
            if (doc.parent === 'profilePictures') {
                DataObjectsEncryption.shareDocWithAllBeneficiaries(doc._id);
            }
        }
    });
    /* global FilesToEncrypt:true */
    FilesToEncrypt = [];
}

function uploadFileWithDataObject(file, dataObject, privateKey) {
    var metaContext = {
            dataObjectId: dataObject._id,
            allowedFileTypes: fileBrowserHelpers.acceptedFileTypes()
        },
        uploader;

    if (privateKey) {
        metaContext.sse = {
            key: privateKey
        };
    }

    uploader = new Slingshot.Upload('files', metaContext);

    uploader.send(file, function (error, downloadUrl) {
        if (error) {
            // Log service detailed response
            if (uploader.xhr) {
                console.error('Error uploading', uploader.xhr.response);
            } else {
                Materialize.toast(error.message, 4000);
            }
            DataObjects.remove({
                _id: dataObject._id
            });
        } else {
            var isThumbnail = downloadUrl.slice(-3);
            if(isThumbnail == "jpg") {
                Session.set("thumbnailVideoSession", downloadUrl);
            }
            DataObjects.direct.update({
                _id: dataObject._id
            }, {
                $set: {
                    url: downloadUrl,
                    ownerId: Meteor.userId(),
                    uploadedAt: new Date(),
                    updatedAt: new Date(),
                    sse: privateKey ? true : false,
                    thumbnail: Session.get("thumbnailVideoSession")
                },
                // unset progress to indicate a finished upload
                $unset: {
                    progress: ""
                }
            });
            if (dataObject.fileName.slice(0,5) == "Video")
                Session.set("thumbnailVideoSession", "-");
        }
    });


    // tracks the upload progress of a file
    Tracker.autorun(function () {
        var progress = uploader.progress();
        if (_.isNumber(progress) && !_.isNaN(progress)) {
            var roundedProgress = Math.round(progress * 100);
            if (roundedProgress < 100) {
                DataObjects.direct.update({
                    _id: dataObject._id
                }, {
                    $set: {
                        progress: roundedProgress
                    }
                });
            }
        }
    });
}
