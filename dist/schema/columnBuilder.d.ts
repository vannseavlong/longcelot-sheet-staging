import { ColumnDefinition, DataType } from './types';
export declare class ColumnBuilder {
    private definition;
    constructor(type: DataType);
    required(): this;
    unique(): this;
    default(value: any): this;
    min(value: number): this;
    max(value: number): this;
    enum(values: any[]): this;
    pattern(regex: RegExp): this;
    readonly(): this;
    primary(): this;
    ref(tableDotColumn: string): this;
    index(): this;
    build(): ColumnDefinition;
}
export declare function string(): ColumnBuilder;
export declare function number(): ColumnBuilder;
export declare function boolean(): ColumnBuilder;
export declare function date(): ColumnBuilder;
export declare function json(): ColumnBuilder;
//# sourceMappingURL=columnBuilder.d.ts.map