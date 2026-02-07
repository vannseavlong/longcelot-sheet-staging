"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ColumnBuilder = void 0;
exports.string = string;
exports.number = number;
exports.boolean = boolean;
exports.date = date;
exports.json = json;
class ColumnBuilder {
    constructor(type) {
        this.definition = { type };
    }
    required() {
        this.definition.required = true;
        return this;
    }
    unique() {
        this.definition.unique = true;
        return this;
    }
    default(value) {
        this.definition.default = value;
        return this;
    }
    min(value) {
        this.definition.min = value;
        return this;
    }
    max(value) {
        this.definition.max = value;
        return this;
    }
    enum(values) {
        this.definition.enum = values;
        return this;
    }
    pattern(regex) {
        this.definition.pattern = regex;
        return this;
    }
    readonly() {
        this.definition.readonly = true;
        return this;
    }
    primary() {
        this.definition.primary = true;
        this.definition.unique = true;
        return this;
    }
    ref(tableDotColumn) {
        this.definition.ref = tableDotColumn;
        return this;
    }
    index() {
        this.definition.index = true;
        return this;
    }
    build() {
        return this.definition;
    }
}
exports.ColumnBuilder = ColumnBuilder;
function string() {
    return new ColumnBuilder('string');
}
function number() {
    return new ColumnBuilder('number');
}
function boolean() {
    return new ColumnBuilder('boolean');
}
function date() {
    return new ColumnBuilder('date');
}
function json() {
    return new ColumnBuilder('json');
}
//# sourceMappingURL=columnBuilder.js.map