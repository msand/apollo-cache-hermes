import { Observable } from "../../utilities/index";

export function fromError<T>(errorValue: any): Observable<T> {
  return new Observable<T>((observer) => {
    observer.error(errorValue);
  });
}
