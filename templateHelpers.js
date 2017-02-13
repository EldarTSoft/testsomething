if(Meteor.isClient){
    Template.customptemplate.helpers({
        isReady: function () {
            return FlowRouter.subsReady();
        },
    });

    Template.fileBrowser.helpers({
        dataObjectsReady: function () {
            return Template.instance().ready.get();
        },
        files: function () {
            var parent = FlowRouter.getParam('dataObjectId');
            var contextDataObject = DataObjects.findOne({
                _id: parent
            });
            return DataObjects.find({
                $and: [{
                    _id: {
                        $ne: parent
                    }
                }, {
                    _id: {
                        $ne: contextDataObject ?
                            contextDataObject.parent : null
                    }
                }, {
                    fileName: {
                        $nin: Object.keys(dashboardFolders)
                    }
                }, {
                    parent: {
                        $nin: _.without(
                            Object.keys(dashboardFolders),
                            parent)
                    }
                }]
            }, {
                sort: {
                    uploadedAt: -1
                }
            }).fetch();
        },
        file: function () {
            return _.extend(DataObjects.findOne({
                    _id: this._id
                }) || {}, {
                subHandle: Template.instance().handle
            });
        },
        isWhatIWantToSay: function () {
            return (FlowRouter.getParam("dashboardCard") ===
            "whatIWantToSay");
        },
    });

    Template.fileCard.helpers({
        progress: function () {
            //return self.uploaded() / total.get();
        },
        isFileWithType: function (fileName, fileType) {
            //Could be problems
            var fileExtension = getFileExtension(fileName);
            if (!fileExtension) {
                return false;
            }
            if (_.indexOf(fileTypes[fileType], fileExtension[0].toLowerCase()) !==
                -1) {
                return true;
            } else {
                return false;
            }
        },
        notKnownFileType: function (fileName) {
            return !isFileWithTypes(fileName, _.keys(fileTypes));
        },
        isDownloading: function() {
            return Template.instance().isDownloading.get();
        },
        isText: function() {
            return (FlowRouter.getParam("dashboardCard") === "whatIWantToSay") && (this.type === 'text');
        },
        url: function (preload) {
            return true;
            if (!dataUri) {
                var localUrl = new ReactiveVar(),
                    URL = (window.URL || window.webkitURL);

                dataUri = new ReactiveVar();

                Tracker.nonreactive(function () {

                    /*
                     It is important that we generate the local url not more than once
                     throughout the entire lifecycle of `self` to prevent flickering.
                     */

                    var previewRequirement = new Tracker.Dependency();

                    Tracker.autorun(function (computation) {
                        if (self.file) {
                            if (URL) {
                                localUrl.set(URL.createObjectURL(self.file));
                                computation.stop();
                            }
                            else if (Tracker.active && window.FileReader) {
                                readDataUrl(self.file, function (result) {
                                    localUrl.set(result);
                                    computation.stop();
                                });
                            }
                        }
                        else {
                            previewRequirement.depend();
                        }
                    });

                    Tracker.autorun(function (computation) {
                        var status = self.status();

                        if (self.instructions && status === "done") {
                            computation.stop();
                            dataUri.set(self.instructions.download);
                        }
                        else if (status === "failed" || status === "aborted") {
                            computation.stop();
                        }
                        else if (self.file && !dataUri.curValue) {
                            previewRequirement.changed();
                            dataUri.set(localUrl.get());
                        }
                    });
                });
            }

            if (preload) {

                if (self.file && !self.isImage())
                    throw new Error("Cannot pre-load anything other than images");

                if (!preloaded) {
                    Tracker.nonreactive(function () {
                        preloaded = new ReactiveVar();

                        Tracker.autorun(function (computation) {
                            var url = dataUri.get();

                            if (self.instructions) {
                                preloadImage(url, function () {
                                    computation.stop();
                                    preloaded.set(url);
                                });
                            }
                            else
                                preloaded.set(url);
                        });
                    });
                }

                return preloaded.get();
            }
            else
                return dataUri.get();
        },

    });

    Template.keyGenLoading.helpers({
        progress: function () {
            //return self.uploaded() / total.get();
        },
    });

}

