var dataService = require("../../../services/data.service");
var eventBusService = require("../../../services/event-bus.service");
var globalService = require("../../../services/global.service");

module.exports = compareMainService = {
  startup: async function() {
    eventBusService.on("beginProcessModuleShortCode", async function(options) {
      if (options.shortcode.name === "COMPARE") {
        options.moduleName = "compare";
        await moduleService.processModuleInColumn(options);
      }
    });

    eventBusService.on("postModuleGetData", async function(options) {
      if (options.shortcode.name !== "COMPARE") {
        return;
      }

      let compareItems = await dataService.getContentByType("compare-item");
      options.viewModel.data.compareItems = compareItems;

      let contentType = await dataService.getContentType("compare-item");
      let tabs = contentType.components[0].components;
      options.viewModel.data.contentType = tabs;

      let matrix = compareMainService.getMatrixData(tabs, compareItems);
      console.log(matrix);
      options.viewModel.data.matrix = matrix;
    });
  },

  getMatrixData: function(contentType, compareItems) {
    let rows = [];
    contentType.forEach(group => {
      let row = { columns: [] };
      row.columns.push(group.label);
      rows.push(row);

      // console.log(group.label);
      group.components.forEach(element => {
        let rowAlreadyProcessed = false;
        let row = { columns: [] };
        if (element.label === "Field Set") {
          let fieldSet = element.components[0];
          row.columns.push("--" + fieldSet.label);
          rows.push(row);
          rowAlreadyProcessed = true;
          //now need another row for child components
          fieldSet.values.forEach(fieldSetValue => {
            let row = { columns: [] };
            row.columns.push("----" + fieldSetValue.label);
            rows.push(row);
          });
        } else {
          row.columns.push("--" + element.label);
        }

        //add columns for compare items
        compareItems.forEach(complareItem => {
          let column = complareItem.data[element.key];
          row.columns.push(column);
        });

        if (!rowAlreadyProcessed) {
          rows.push(row);
        }

        // if (element.components) {
        //   // let row = { columns: [] };
        //   element.components.forEach(subElement => {
        //     row.columns.push(subElement.label);

        //     //find matching compare item row
        //     compareItems.forEach(complareItem => {
        //       let column = complareItem.data[element.key];
        //       row.columns.push(column);
        //     });
        //   });
        //   rows.push(row);

        // }
      });
    });
    return rows;
  }
};
