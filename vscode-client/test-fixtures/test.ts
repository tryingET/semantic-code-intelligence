
// Test file for Ontology LSP
function getUserData(userId: string): Promise<User> {
    return fetch(`/api/users/${userId}`)
        .then(response => response.json());
}

function fetchUserInfo(id: string): Promise<User> {
    return getUserData(id);
}

interface User {
    id: string;
    name: string;
    email: string;
}

class UserService {
    private users: Map<string, User> = new Map();
    
    async getUser(userId: string): Promise<User | null> {
        return this.users.get(userId) || null;
    }
    
    async loadUserData(id: string): Promise<User> {
        const user = await getUserData(id);
        this.users.set(user.id, user);
        return user;
    }
}