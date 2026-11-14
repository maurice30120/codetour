from models import Repository, UserService


def handle_request(repository: Repository, item_id):
    service = UserService(repository)
    return service.get_user(item_id)
