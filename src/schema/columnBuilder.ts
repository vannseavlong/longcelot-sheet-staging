import { ColumnDefinition, DataType } from './types';

export class ColumnBuilder {
  private definition: ColumnDefinition;

  constructor(type: DataType) {
    this.definition = { type };
  }

  required(): this {
    this.definition.required = true;
    return this;
  }

  unique(): this {
    this.definition.unique = true;
    return this;
  }

  default(value: any): this {
    this.definition.default = value;
    return this;
  }

  min(value: number): this {
    this.definition.min = value;
    return this;
  }

  max(value: number): this {
    this.definition.max = value;
    return this;
  }

  enum(values: any[]): this {
    this.definition.enum = values;
    return this;
  }

  pattern(regex: RegExp): this {
    this.definition.pattern = regex;
    return this;
  }

  readonly(): this {
    this.definition.readonly = true;
    return this;
  }

  primary(): this {
    this.definition.primary = true;
    this.definition.unique = true;
    this.definition.required = true;
    return this;
  }

  ref(tableDotColumn: string): this {
    this.definition.ref = tableDotColumn;
    return this;
  }

  index(): this {
    this.definition.index = true;
    return this;
  }

  build(): ColumnDefinition {
    return this.definition;
  }
}

export function string(): ColumnBuilder {
  return new ColumnBuilder('string');
}

export function number(): ColumnBuilder {
  return new ColumnBuilder('number');
}

export function boolean(): ColumnBuilder {
  return new ColumnBuilder('boolean');
}

export function date(): ColumnBuilder {
  return new ColumnBuilder('date');
}

export function json(): ColumnBuilder {
  return new ColumnBuilder('json');
}
