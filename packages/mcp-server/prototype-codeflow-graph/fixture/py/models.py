class Repository:
    def find(self, item_id):
        return None


class UserService:
    def __init__(self, repository):
        self.repository = repository

    def get_user(self, item_id):
        self._validate(item_id)
        return self.repository.find(item_id)

    def _validate(self, item_id):
        if not item_id:
            raise ValueError("missing")
