# Sample Python file for testing Ontology LSP
from typing import Optional, List, Dict, Any

class UserRepository:
    def __init__(self):
        self.users: List[Dict[str, Any]] = []
    
    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by ID"""
        for user in self.users:
            if user['id'] == user_id:
                return user
        return None
    
    def fetch_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Fetch user by ID (async-like pattern)"""
        return self.get_user(user_id)
    
    def create_user(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new user"""
        user = {
            'id': user_data.get('id', self._generate_id()),
            'name': user_data.get('name', 'Unknown'),
            'email': user_data.get('email', ''),
            **user_data
        }
        self.users.append(user)
        return user
    
    def update_user(self, user_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update existing user"""
        user = self.get_user(user_id)
        if user:
            user.update(updates)
        return user
    
    def _generate_id(self) -> str:
        """Generate a random ID"""
        import random
        import string
        return ''.join(random.choices(string.ascii_lowercase + string.digits, k=9))


# Similar patterns for testing pattern learning
class ProductRepository:
    def __init__(self):
        self.products: List[Dict[str, Any]] = []
    
    def get_product(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Get product by ID"""
        for product in self.products:
            if product['id'] == product_id:
                return product
        return None
    
    def fetch_product(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Fetch product by ID (async-like pattern)"""
        return self.get_product(product_id)
    
    def create_product(self, product_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new product"""
        product = {
            'id': product_data.get('id', self._generate_id()),
            'name': product_data.get('name', 'Unknown Product'),
            'price': product_data.get('price', 0.0),
            **product_data
        }
        self.products.append(product)
        return product
    
    def _generate_id(self) -> str:
        """Generate a random ID"""
        import random
        import string
        return ''.join(random.choices(string.ascii_lowercase + string.digits, k=9))


if __name__ == '__main__':
    # Example usage
    repo = UserRepository()
    user = repo.create_user({'name': 'John Doe', 'email': 'john@example.com'})
    print(f"Created user: {user}")
    
    found_user = repo.get_user(user['id'])
    print(f"Found user: {found_user}")