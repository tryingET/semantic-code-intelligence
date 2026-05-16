// Sample TypeScript file for testing Ontology LSP
export class UserService {
    private users: User[] = [];
    
    getUser(id: string): User | undefined {
        return this.users.find(user => user.id === id);
    }
    
    fetchUser(id: string): Promise<User | undefined> {
        return Promise.resolve(this.getUser(id));
    }
    
    createUser(userData: Partial<User>): User {
        const user: User = {
            id: userData.id || generateId(),
            name: userData.name || 'Unknown',
            email: userData.email || ''
        };
        this.users.push(user);
        return user;
    }
    
    updateUser(id: string, updates: Partial<User>): User | undefined {
        const user = this.getUser(id);
        if (user) {
            Object.assign(user, updates);
        }
        return user;
    }
}

export interface User {
    id: string;
    name: string;
    email: string;
}

function generateId(): string {
    return Math.random().toString(36).substr(2, 9);
}

// Similar patterns for testing pattern learning
export class ProductService {
    private products: Product[] = [];
    
    getProduct(id: string): Product | undefined {
        return this.products.find(product => product.id === id);
    }
    
    fetchProduct(id: string): Promise<Product | undefined> {
        return Promise.resolve(this.getProduct(id));
    }
    
    createProduct(productData: Partial<Product>): Product {
        const product: Product = {
            id: productData.id || generateId(),
            name: productData.name || 'Unknown Product',
            price: productData.price || 0
        };
        this.products.push(product);
        return product;
    }
}

export interface Product {
    id: string;
    name: string;
    price: number;
}