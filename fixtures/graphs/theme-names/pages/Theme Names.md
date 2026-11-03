- # Theme names
- Code in every language seqno highlights, so a theme's token colors reach each kind.
	- ```js
	  /** Water the bed. @param {Bed} bed - the bed to check */
	  const due = (bed) => /dry/.test(bed.soil) && `water ${bed.name}` !== null
	  ```
	- ```html
	  <!doctype html>
	  <label for="bed">Bed &amp; row</span>
	  ```
	- ```python
	  @dataclass
	  class Bed:
	      def water(self, litres):
	          print(len(self.rows), True)
	  ```
	- ```css
	  #greenhouse .bed:hover, input[type=number] { color: #3a7d44; display: block; }
	  ```
	- ```clojure
	  (defn water [bed] (assoc bed :moisture 1))
	  ```
- ## Heading two
- ### Heading three
- #### Heading four
- ##### Heading five
- ###### Heading six
- #+BEGIN_NOTE
  Sow the beans after the last frost.
  #+END_NOTE
- #+BEGIN_TIP
  Water in the morning, never at night.
  #+END_TIP
- #+BEGIN_IMPORTANT
  Close the vents before the storm.
  #+END_IMPORTANT
- #+BEGIN_CAUTION
  The heater gets hot.
  #+END_CAUTION
- #+BEGIN_WARNING
  Frost is forecast tonight.
  #+END_WARNING
- #+BEGIN_PINNED
  Order seeds by February.
  #+END_PINNED
- A block to schedule
