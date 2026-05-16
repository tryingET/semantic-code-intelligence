// Sample JavaScript file for testing Ontology LSP
class DataManager {
    constructor() {
        this.items = [];
    }
    
    getItem(id) {
        return this.items.find(item => item.id === id);
    }
    
    fetchItem(id) {
        return Promise.resolve(this.getItem(id));
    }
    
    addItem(itemData) {
        const item = {
            id: itemData.id || this.generateId(),
            name: itemData.name || 'Unknown',
            ...itemData
        };
        this.items.push(item);
        return item;
    }
    
    updateItem(id, updates) {
        const item = this.getItem(id);
        if (item) {
            Object.assign(item, updates);
        }
        return item;
    }
    
    generateId() {
        return Math.random().toString(36).substr(2, 9);
    }
}

module.exports = { DataManager };