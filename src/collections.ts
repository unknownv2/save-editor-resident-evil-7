import  {ListEntry} from './savedata';


export interface DictionaryCollection {

    items: any[];
    list: ListEntry;

    // retrieve and set structure buffers directly 
    getBufferFromEntry(entry: ListEntry, id: string): Buffer;
    setBufferForEntry(index:number, id: string, data: Buffer): void;

    getValue(entry: ListEntry, id: string): any;
    setValue(index:number, id: string, data: string|number|boolean): void;

    // add item to list
    insert(structure: any): any;
    // parse entry to structure
    parseListEntry(list: ListEntry): any;
}